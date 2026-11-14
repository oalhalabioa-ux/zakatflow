import Decimal from 'decimal.js';
import type {DimensionEvidence} from './financial-dimensional-statements';
import type {StatementSource} from './financial-statement-engine';
const Money=Decimal.clone({precision:50});
type Part=DimensionEvidence['opening'][number]['allocations'][number];
export type DimensionalOpeningWorkspace={
 id:string;organizationId:string;fiscalStart:string;currency:string;version:number;digest:string;
 status:'APPROVED';items:readonly {itemId:string;accountId:string;debit:string;credit:string}[];
};
export type DimensionalOpeningDistribution={
 id:string;organizationId:string;openingWorkspaceId:string;openingVersion:number;openingDigest:string;
 status:'APPROVED';approvedBy:string;revision:string;
 entries:Record<string,readonly Part[]>;
};
function amount(s:string){if(typeof s!=='string'||!/^\d{1,20}(\.\d{1,4})?$/.test(s))throw Error('DIMENSION_OPENING_AMOUNT_INVALID');return new Money(s)}
/** Server-side adapter primitive. Approval/digest must come from a locked,
 * authorized storage read, never from request JSON. Preserve voucher identity
 * before aggregating by GL account; two vouchers sharing an account are not
 * interchangeable. No default center or balancing allocation is synthesized.
 */
export function aggregateDimensionalOpenings(source:StatementSource,w:DimensionalOpeningWorkspace,d:DimensionalOpeningDistribution):DimensionEvidence['opening']{
 if(w.status!=='APPROVED'||d.status!=='APPROVED'||!d.id||!d.approvedBy||!d.revision||!w.id||!w.digest||!Number.isInteger(w.version)||w.version<1||
  w.organizationId!==source.organizationId||d.organizationId!==source.organizationId||w.fiscalStart!==source.fiscalStart||w.currency!==source.currency||
  d.openingWorkspaceId!==w.id||d.openingVersion!==w.version||d.openingDigest!==w.digest)throw Error('DIMENSION_OPENING_SOURCE_STALE');
 const ids=new Set<string>(),groups=new Map<string,{debit:Decimal;credit:Decimal;parts:Map<string,{branchId:string|null;centerId:string|null;debit:Decimal;credit:Decimal}>}>();
 for(const item of w.items){
  if(!item.itemId||!item.accountId||ids.has(item.itemId))throw Error('DIMENSION_OPENING_ITEM_INVALID');ids.add(item.itemId);
  const debit=amount(item.debit),credit=amount(item.credit);
  if(debit.gt(0)&&credit.gt(0))throw Error('DIMENSION_OPENING_ITEM_INVALID');
  const parts=d.entries[item.itemId];if(!Array.isArray(parts)||!parts.length)throw Error('DIMENSION_OPENING_ITEM_MISSING');
  const seen=new Set<string>();let dr=new Money(0),cr=new Money(0);
  const g=groups.get(item.accountId)??{debit:new Money(0),credit:new Money(0),parts:new Map()};
  for(const p of parts){
   if((p.branchId!==null&&(typeof p.branchId!=='string'||!p.branchId))||(p.centerId!==null&&(typeof p.centerId!=='string'||!p.centerId)))throw Error('DIMENSION_OPENING_PART_INVALID');
   const key=JSON.stringify([p.branchId,p.centerId]),pd=amount(p.debit),pc=amount(p.credit);
   if(seen.has(key)||(pd.gt(0)&&pc.gt(0))||(debit.isZero()&&!pd.isZero())||(credit.isZero()&&!pc.isZero()))throw Error('DIMENSION_OPENING_PART_INVALID');seen.add(key);
   dr=dr.plus(pd);cr=cr.plus(pc);
   const prior=g.parts.get(key)??{branchId:p.branchId,centerId:p.centerId,debit:new Money(0),credit:new Money(0)};
   g.parts.set(key,{...prior,debit:prior.debit.plus(pd),credit:prior.credit.plus(pc)});
  }
  if(!dr.eq(debit)||!cr.eq(credit))throw Error('DIMENSION_OPENING_ITEM_UNRECONCILED');
  g.debit=g.debit.plus(debit);g.credit=g.credit.plus(credit);groups.set(item.accountId,g);
 }
 if(Object.keys(d.entries).length!==ids.size||Object.keys(d.entries).some(id=>!ids.has(id)))throw Error('DIMENSION_OPENING_ITEM_EXTRA');
 const sourceIds=new Set(source.opening.map(r=>r.accountId));
 if(sourceIds.size!==source.opening.length||sourceIds.size!==groups.size)throw Error('DIMENSION_OPENING_ACCOUNT_INCOMPLETE');
 return source.opening.map(row=>{
  const g=groups.get(row.accountId);
  if(!g||!g.debit.minus(g.credit).eq(amount(row.debit).minus(amount(row.credit))))throw Error('DIMENSION_OPENING_ACCOUNT_UNRECONCILED');
  const allocations=[...g.parts.values()].map(p=>({...p,debit:Money.max(p.debit.minus(p.credit),0).toFixed(4),credit:Money.max(p.credit.minus(p.debit),0).toFixed(4)}));
  // The current dimensional compiler accepts exact debit/credit source legs.
  // Opposite-signed segments need a separately verified gross opening contract;
  // refusing them is safer than manufacturing an offsetting opening balance.
  if(!allocations.reduce((n,p)=>n.plus(p.debit),new Money(0)).eq(row.debit)||!allocations.reduce((n,p)=>n.plus(p.credit),new Money(0)).eq(row.credit))throw Error('DIMENSION_OPENING_GROSS_SOURCE_REQUIRED');
  return{accountId:row.accountId,allocations};
 });
}
