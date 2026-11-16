import {z} from 'zod';
import Decimal from 'decimal.js';
import {projectFinancialStatements} from './financial-statement-engine';

const Money=Decimal.clone({precision:50});
const id=z.string().trim().min(1).max(300),currency=z.string().regex(/^[A-Z]{3}$/),date=z.string().date();
const money=z.string().regex(/^\d{1,20}(\.\d{1,4})?$/);
const balance={debit:money,credit:money};
const ref=z.object({module:id,recordId:id,lineId:id}).strict();
const schema=z.object({
 organizationId:z.string().uuid(),currency,openingDate:date,fiscalStart:date,
 scope:z.literal('ORGANIZATION_ALL_ENTITIES'),
 accounts:z.array(z.object({id,code:id,ar:id,en:id,kind:z.enum(['ASSET','LIABILITY','EQUITY','REVENUE','COGS','OPEX','FINANCE','TAX']),cash:z.boolean(),presentation:z.enum(['CURRENT','NON_CURRENT','OTHER'])}).strict()).min(1).max(1000),
 coverage:z.object({complete:z.literal(true),rawSourceCount:z.number().int().min(0).max(20000),revision:id}).strict(),
 sources:z.array(z.object({canonicalLineKey:id,accountId:id.nullable(),organizationId:z.string().uuid(),currency,valuationDate:date,kind:z.literal('OPENING'),basis:z.literal('BOOK_BALANCE'),...balance,refs:z.array(ref).min(1).max(20)}).strict()).max(20000),
 target:z.object({sourceId:id,complete:z.literal(true),rowCount:z.number().int().min(1).max(1000),rows:z.array(z.object({accountCode:id,rowRef:id,...balance}).strict()).min(1).max(1000)}).strict(),
}).strict();
export type OpeningWorkbenchInput=z.infer<typeof schema>;
export type OpeningBlocker={code:string;reference:string};
const fixed=(v:Decimal)=>v.toFixed(4);
function net(row:{debit:string;credit:string}){if(new Money(row.debit).gt(0)&&new Money(row.credit).gt(0))throw Error('MIXED_OPENING_DEBIT_CREDIT');return new Money(row.debit).minus(row.credit)}
const split=(value:Decimal)=>({debit:fixed(value.gt(0)?value:new Money(0)),credit:fixed(value.lt(0)?value.negated():new Money(0))});

/** A read-only reconciliation, NOT a posting command or approval.
 * Trusted adapters must establish canonical identities, scope, book balances at the
 * cutoff, and full coverage. Client declarations cannot establish those facts.
 * The final opening is emitted ONCE; target amounts are never added to vouchers.
 */
export function reconcileOpeningWorkbench(input:unknown){
 const parsed=schema.safeParse(input);if(!parsed.success)throw Error('OPENING_WORKBENCH_INVALID');const p=parsed.data;
 if(p.sources.length!==p.coverage.rawSourceCount||p.target.rows.length!==p.target.rowCount)throw Error('OPENING_SOURCE_INCOMPLETE');
 const accounts=new Map(p.accounts.map(a=>[a.id,a])),codes=new Map(p.accounts.map(a=>[a.code,a]));
 if(accounts.size!==p.accounts.length||codes.size!==p.accounts.length)throw Error('DUPLICATE_OPENING_ACCOUNT');
 const blockers:OpeningBlocker[]=[],seenRefs=new Map<string,string>(),canonical=new Map<string,typeof p.sources[number]>(),existing=new Map<string,Decimal>();
 for(const row of p.sources){
  if(row.organizationId!==p.organizationId||row.currency!==p.currency)throw Error('OPENING_SCOPE_MISMATCH');
  if(row.valuationDate!==p.openingDate)throw Error('OPENING_CUTOFF_MISMATCH');net(row);
  const previous=canonical.get(row.canonicalLineKey);
  if(previous&&(previous.accountId!==row.accountId||!new Money(previous.debit).eq(row.debit)||!new Money(previous.credit).eq(row.credit)))throw Error('CONFLICTING_OPENING_SOURCE');
  for(const r of row.refs){const key=JSON.stringify([r.module,r.recordId,r.lineId]),prior=seenRefs.get(key);if(prior&&prior!==row.canonicalLineKey)throw Error('OPENING_CANONICAL_IDENTITY_REQUIRED');seenRefs.set(key,row.canonicalLineKey)}
  if(previous){const refs=new Map([...previous.refs,...row.refs].map(r=>[JSON.stringify(r),r]));previous.refs=[...refs.values()];continue}
  canonical.set(row.canonicalLineKey,{...row,refs:[...row.refs]});
  if(!row.accountId||!accounts.has(row.accountId)){blockers.push({code:'OPENING_SOURCE_ACCOUNT_UNMAPPED',reference:row.canonicalLineKey});continue}
  existing.set(row.accountId,(existing.get(row.accountId)??new Money(0)).plus(net(row)));
 }
 const targets=new Map<string,{value:Decimal;rowRef:string}>(),targetCodes=new Set<string>(),targetRefs=new Set<string>();
 let targetDebit=new Money(0),targetCredit=new Money(0);
 for(const row of p.target.rows){
  if(targetCodes.has(row.accountCode)||targetRefs.has(row.rowRef))throw Error('DUPLICATE_OPENING_TARGET_ROW');targetCodes.add(row.accountCode);targetRefs.add(row.rowRef);
  const value=net(row);targetDebit=targetDebit.plus(row.debit);targetCredit=targetCredit.plus(row.credit);
  const account=codes.get(row.accountCode);if(!account){blockers.push({code:'OPENING_TARGET_ACCOUNT_UNMAPPED',reference:row.accountCode});continue}
  targets.set(account.id,{value,rowRef:row.rowRef});
 }
 if(!targetDebit.eq(targetCredit))blockers.push({code:'OPENING_TRIAL_BALANCE_UNBALANCED',reference:p.target.sourceId});
 for(const [accountId,value]of existing)if(!value.isZero()&&!targets.has(accountId))blockers.push({code:'OPENING_SOURCE_ACCOUNT_MISSING_FROM_TARGET',reference:accounts.get(accountId)!.code});
 const sourcesByAccount=new Map<string,typeof p.sources>();for(const row of canonical.values())if(row.accountId){const entries=sourcesByAccount.get(row.accountId)??[];entries.push(row);sourcesByAccount.set(row.accountId,entries)}
 const rows=p.accounts.map(account=>{
  const known=existing.get(account.id)??new Money(0),target=targets.get(account.id),final=target?.value??known,difference=final.minus(known);
  return{accountId:account.id,accountCode:account.code,ar:account.ar,en:account.en,existing:split(known),supplement:split(difference),final:split(final),targetRowRef:target?.rowRef??null,requiresCorrectionReview:!known.isZero()&&!difference.isZero()&&(known.isPositive()!==final.isPositive()||final.abs().lt(known.abs())),sources:(sourcesByAccount.get(account.id)??[]).map(r=>({canonicalLineKey:r.canonicalLineKey,refs:r.refs}))};
 });
 const candidate={organizationId:p.organizationId,currency:p.currency,openingDate:p.openingDate,fiscalStart:p.fiscalStart,from:p.fiscalStart,to:p.fiscalStart,accounts:p.accounts.map(a=>({...a,organizationId:p.organizationId,currency:p.currency})),opening:rows.filter(r=>targets.has(r.accountId)).map(r=>({accountId:r.accountId,...r.final})),journals:[]};
 if(!blockers.length)try{projectFinancialStatements(candidate)}catch(e){blockers.push({code:e instanceof Error?e.message:'OPENING_ENGINE_VALIDATION_FAILED',reference:p.target.sourceId})}
 const total=(key:'existing'|'supplement'|'final')=>rows.reduce((out,row)=>({debit:out.debit.plus(row[key].debit),credit:out.credit.plus(row[key].credit)}),{debit:new Money(0),credit:new Money(0)});
 const totals=Object.fromEntries((['existing','supplement','final']as const).map(key=>{const t=total(key);return[key,{debit:fixed(t.debit),credit:fixed(t.credit),difference:fixed(t.debit.minus(t.credit))}]})) as Record<'existing'|'supplement'|'final',{debit:string;credit:string;difference:string}>;
 return{status:blockers.length?'BLOCKED' as const:'DRAFT_READY_FOR_REVIEW' as const,postingAllowed:false as const,scope:p.scope,organizationId:p.organizationId,currency:p.currency,openingDate:p.openingDate,revision:p.coverage.revision,targetSourceId:p.target.sourceId,rawSourceCount:p.sources.length,canonicalSourceCount:canonical.size,blockers,rows,totals,targetControls:{debit:fixed(targetDebit),credit:fixed(targetCredit),difference:fixed(targetDebit.minus(targetCredit))},unmappedSources:[...canonical.values()].filter(r=>!r.accountId||!accounts.has(r.accountId)),openingCandidate:blockers.length?null:{openingSourceId:'workbench:'+p.target.sourceId,...candidate}};
}
