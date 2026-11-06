import Decimal from 'decimal.js';
import {projectFinancialStatements,type StatementSource,type OpeningBalance,type PostedJournal} from './financial-statement-engine';
import {validateBranchAllocations,type BranchSourceLine,type BranchAllocationInput,type BranchAllocationDiagnostic} from './financial-branch-allocation';

/**
 * Reconciled branch-level statement preview from a full, authenticated source.
 *
 * IMPORTANT: This is a pure accounting compiler, not a database adapter.
 * The caller MUST receive the company source and its complete line-attribution
 * revision from one trusted, permission-scoped server transaction. Never accept
 * client-generated coverage attestations as authority for issuing statements.
 * No production endpoint currently issues these results.
 */
export type BranchStatementInput={
 source:StatementSource;
 branchIds:readonly string[];
 coverage:BranchAllocationInput['coverage'];
 /** One allocation record for EACH canonical opening/journal line, not just
  * each account or voucher. Null branchId = headquarters of this legal company. */
 allocations:readonly BranchSourceLine[];
};
type Statement=ReturnType<typeof projectFinancialStatements>;
export type BranchStatementPreview={
 status:'RECONCILED_SEGMENTS_PREVIEW_ONLY'|'BLOCKED';
 issues:(BranchAllocationDiagnostic|{code:'SEGMENT_LEDGER_INVALID'|'SEGMENT_COMPANY_MISMATCH';branchId?:string|null})[];
 company:Statement|null;
 segments:{branchId:string|null;scope:'ORGANIZATION_DIRECT'|'BRANCH';statement:Statement}[];
 revision:string;
};

const Money=Decimal.clone({precision:50});
const key=(kind:'OPENING'|'JOURNAL',id:string)=>kind+':'+id;
const nonNegative=/^\d{1,20}(\.\d{1,4})?$/;
function decimal(v:string){
 if(typeof v!=='string'||!nonNegative.test(v))throw Error('BRANCH_STATEMENT_SOURCE_AMOUNT_INVALID');
 return new Money(v);
}
function sumMetrics(s:Statement){
 return [...Object.values(s.income),...Object.values(s.position),...Object.values(s.cash)] as string[];
}
function empty():BranchStatementPreview{
 throw Error('BRANCH_STATEMENT_SOURCE_INCOMPLETE');
}

/** Stable IDs tie each attribution to the exact line of a posted event. */
export function branchStatementSourceLines(source:StatementSource):Omit<BranchSourceLine,'allocations'>[]{
 const rows:Omit<BranchSourceLine,'allocations'>[]=[];
 for(const r of source.opening)rows.push({sourceKind:'OPENING',sourceId:'OPEN:'+r.accountId,accountCode:r.accountId,debit:r.debit,credit:r.credit});
 for(const journal of source.journals){
  if(journal.status!=='POSTED'||journal.date>source.to)continue;
  for(let i=0;i<journal.lines.length;i++){
   const line=journal.lines[i];
   rows.push({sourceKind:'JOURNAL',sourceId:'J:'+journal.id+':'+i,accountCode:line.accountId,debit:line.debit,credit:line.credit});
  }
 }
 return rows;
}

/**
 * Every source line must be attributed exactly once, every segment must
 * independently balance both openings and movements, every segment's journals
 * must balance individually, and ALL statement metrics must sum exactly to
 * the source company's certified report. Otherwise: no partial financials.
 */
export function compileBranchStatementPreview(input:BranchStatementInput):BranchStatementPreview{
 const company=projectFinancialStatements(input.source);
 const expected=branchStatementSourceLines(input.source);
 if(!input.coverage?.revision?.trim()||input.coverage?.scope!=='ORGANIZATION_ALL_ENTITIES'||input.coverage.complete!==true
  ||input.coverage.sourceCount!==expected.length||input.allocations.length!==expected.length||expected.length>20000)return empty();
 const ids=new Set<string>(),lookup=new Map<string,BranchSourceLine>();
 for(const allocation of input.allocations){
  const id=key(allocation.sourceKind,allocation.sourceId);
  if(ids.has(id))throw Error('BRANCH_STATEMENT_DUPLICATE_ALLOCATION');
  ids.add(id);lookup.set(id,allocation);
 }
 for(const row of expected){
  const allocated=lookup.get(key(row.sourceKind,row.sourceId));
  if(!allocated||allocated.accountCode!==row.accountCode
   ||!decimal(allocated.debit).eq(decimal(row.debit))
   ||!decimal(allocated.credit).eq(decimal(row.credit)))throw Error('BRANCH_STATEMENT_SOURCE_MISMATCH');
 }
 const allocations=validateBranchAllocations({
  organizationId:input.source.organizationId,currency:input.source.currency,
  branchIds:input.branchIds,coverage:input.coverage,sourceLines:input.allocations,
 });
 const base={revision:input.coverage.revision};
 if(allocations.status==='BLOCKED'){
  return{...base,status:'BLOCKED',issues:allocations.issues,company:null,segments:[]};
 }
 const segments:(string|null)[]=[null,...input.branchIds];
 const reports:{branchId:string|null;scope:'ORGANIZATION_DIRECT'|'BRANCH';statement:Statement}[]=[];
 for(const branchId of segments){
  const openings=new Map<string,{debit:Decimal;credit:Decimal}>();
  for(const row of input.source.opening){
   const matched=lookup.get(key('OPENING','OPEN:'+row.accountId))!;
   const attribution=matched.allocations.find(a=>a.branchId===branchId);
   if(!attribution)continue;
   const old=openings.get(row.accountId)??{debit:new Money(0),credit:new Money(0)};
   openings.set(row.accountId,{debit:old.debit.plus(attribution.debit),credit:old.credit.plus(attribution.credit)});
  }
  const segmentOpening:OpeningBalance[]=[...openings].map(([accountId,v])=>({
   accountId,debit:v.debit.toFixed(4),credit:v.credit.toFixed(4),
  }));
  const journals:PostedJournal[]=[];
  for(const j of input.source.journals){
   if(j.status!=='POSTED'||j.date>input.source.to)continue;
   const lines:PostedJournal['lines']=[];
   j.lines.forEach((original,index)=>{
    const attribution=lookup.get(key('JOURNAL','J:'+j.id+':'+index))!.allocations.find(a=>a.branchId===branchId);
    if(!attribution||decimal(attribution.debit).plus(attribution.credit).isZero())return;
    lines.push({...original,debit:decimal(attribution.debit).toFixed(4),credit:decimal(attribution.credit).toFixed(4)});
   });
   if(lines.length)journals.push({...j,lines});
  }
  let statement:Statement;
  try{
   statement=projectFinancialStatements({...input.source,opening:segmentOpening,journals});
  }catch{
   return{...base,status:'BLOCKED',issues:[{code:'SEGMENT_LEDGER_INVALID',branchId}],company:null,segments:[]};
  }
  reports.push({branchId,scope:branchId===null?'ORGANIZATION_DIRECT':'BRANCH',statement});
 }
 const control=sumMetrics(company),rows=reports.map(s=>sumMetrics(s.statement));
 if(control.some((value,i)=>!rows.reduce((acc,r)=>acc.plus(r[i]),new Money(0)).eq(value))){
  return{...base,status:'BLOCKED',issues:[{code:'SEGMENT_COMPANY_MISMATCH'}],company:null,segments:[]};
 }
 return{...base,status:'RECONCILED_SEGMENTS_PREVIEW_ONLY',issues:[],company,segments:reports};
}
