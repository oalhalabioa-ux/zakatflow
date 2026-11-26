import Decimal from 'decimal.js';
import {z} from 'zod';
import {attributeGroupNonControllingInterests} from './financial-group-acquisition';
import {validateGroupControlScope,type GroupControlPreflight} from './financial-group-control';

const Money=Decimal.clone({precision:50,rounding:Decimal.ROUND_HALF_UP});
const signed=z.string().regex(/^-?\d{1,20}(\.\d{1,4})?$/);
const request=z.object({
 subsidiaryOrganizationId:z.string().uuid(),currency:z.string().regex(/^[A-Z]{3}$/),
 method:z.literal('PROPORTIONATE_NET_ASSETS'),
 consideration:signed,carryingNetAssets:signed,openingNci:signed,
 beforeProfit:signed,afterProfit:signed,beforeOci:signed,afterOci:signed,
 sourceEvidence:z.string().trim().min(8),
}).strict();

/** A single direct ordinary-share exchange while control is retained. Inputs
 * are results already adjusted for the consolidation, sliced at the exchange
 * date. Recorded evidence must establish the carrying basis and consideration.
 */
export function reviewGroupOwnershipChange(before:GroupControlPreflight,after:GroupControlPreflight,input:unknown){
 const p=request.parse(input);
 const a=validateGroupControlScope(before),b=validateGroupControlScope(after);
 const previousMember=a.members.find(m=>m.organizationId===p.subsidiaryOrganizationId);
 const nextMember=b.members.find(m=>m.organizationId===p.subsidiaryOrganizationId);
 const previousRelationship=before.relationships.find(r=>r.subsidiaryOrganizationId===p.subsidiaryOrganizationId);
 const nextRelationship=after.relationships.find(r=>r.subsidiaryOrganizationId===p.subsidiaryOrganizationId);
 const nextDay=new Date(Date.parse(a.to)+86400000).toISOString().slice(0,10);
 if(a.rootOrganizationId!==b.rootOrganizationId||a.members.length!==2||b.members.length!==2||
  previousMember?.parentOrganizationId!==a.rootOrganizationId||nextMember?.parentOrganizationId!==b.rootOrganizationId||
  previousMember.controlAssessmentId===nextMember.controlAssessmentId||a.to>=b.from||nextDay!==b.from||
  previousRelationship?.effectiveTo!==a.to||nextRelationship?.effectiveFrom!==b.from)
  throw Error('GROUP_OWNERSHIP_CONTINUITY_REQUIRED');

 const previousPercent=new Money(previousMember.directEconomicInterestPercent);
 const nextPercent=new Money(nextMember.directEconomicInterestPercent);
 const difference=nextPercent.minus(previousPercent);
 if(difference.isZero()||new Money(p.consideration).isNegative())
  throw Error('GROUP_OWNERSHIP_EXCHANGE_INVALID');
 const carryingNetAssets=new Money(p.carryingNetAssets);
 const atPrecision=(x:Decimal)=>x.toDecimalPlaces(4);
 function attribute(control:GroupControlPreflight,openingNci:string,adjustedProfit:string,oci:string){
  return attributeGroupNonControllingInterests(control,{
   parentOrganizationId:control.rootOrganizationId,subsidiaryOrganizationId:p.subsidiaryOrganizationId,
   currency:p.currency,from:control.from,to:control.to,openingNci,adjustedProfit,
   oci:[{id:'period-other-comprehensive-income',amount:oci}],ordinaryDividends:'0',
   ownershipChanges:false,otherEquityChanges:false,goodwillImpairment:'0.0000',
   instruments:'ORDINARY_PROPORTIONATE',sourceEvidence:p.sourceEvidence,
  },p.currency);
 }
 const previous=attribute(before,p.openingNci,p.beforeProfit,p.beforeOci);
 const nciBefore=atPrecision(carryingNetAssets.times(new Money(100).minus(previousPercent)).div(100));
 if(!nciBefore.eq(previous.closingNci))throw Error('GROUP_OWNERSHIP_CARRYING_BASIS_MISMATCH');
 const nciAfter=atPrecision(carryingNetAssets.times(new Money(100).minus(nextPercent)).div(100));
 const nciChange=nciAfter.minus(nciBefore);
 const cashChange=new Money(p.consideration).times(difference.isPositive()?-1:1);
 const subsequent=attribute(after,nciAfter.toFixed(4),p.afterProfit,p.afterOci);
 return {status:'GROUP_OWNERSHIP_CHANGE_REVIEW_ONLY' as const,currency:p.currency,
  effectiveDate:b.from,parentBefore:previousPercent.toFixed(6),parentAfter:nextPercent.toFixed(6),
  nciBefore:nciBefore.toFixed(4),nciAfter:nciAfter.toFixed(4),nciEquityChange:nciChange.toFixed(4),
  parentEquityChange:cashChange.minus(nciChange).toFixed(4),considerationCashChange:cashChange.toFixed(4),
  profitImpact:'0.0000',goodwillImpact:'0.0000',
  profitToNciBefore:previous.profit.nci,profitToNciAfter:subsequent.profit.nci,
  closingNci:subsequent.closingNci};
}
