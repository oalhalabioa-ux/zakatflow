import Decimal from 'decimal.js';
import type {OpeningWorkspaceData} from './financial-opening-workspace';
import {openingPreviewState} from './financial-opening-preview';
import {openingEquityExtraRows} from './financial-opening-equity';

const Money=Decimal.clone({precision:50});
type Category='ASSET'|'LIABILITY'|'EQUITY';
export type DraftOpeningReport={
 organizationId:string;fiscalStart:string;currency:string;draftId:string;draftVersion:number;
 sourceChanged:boolean;balanced:boolean;pending:number;sourceIssues:number;
 debit:string;credit:string;assets:string;liabilities:string;equity:string;cash:string;
 rows:{code:string;ar:string;en:string;kind:Category;debit:string;credit:string;pending:number}[];
};

/** Read-only opening-only statement. Never posts the draft or substitutes for an approved ledger. */
export function financialDraftOpeningReport(data:OpeningWorkspaceData):DraftOpeningReport|null {
 const workspace=data.workspace;
 if(!workspace||workspace.status!=='DRAFT')return null;
 const drafts=workspace.entries;
 const rows=[...data.source.rows.map(row=>{
  const code=drafts[row.id]?.accountCode??row.accountCode;
  const account=data.chart.find(a=>a.code===code);
  return account?{...row,accountCode:code,accountAr:account.ar,accountEn:account.en}:row;
 }),...openingEquityExtraRows(data.chart,drafts)];
 const state=openingPreviewState(rows,drafts);
 const byCode=new Map(data.chart.map(a=>[a.code,a]));
 const lines=state.trialBalance.filter(row=>row.confirmed>0).map(row=>{
  const account=byCode.get(row.code);
  const kind=account?.kind;
  if(!kind||!['ASSET','LIABILITY','EQUITY'].includes(kind))throw Error('OPENING_PREVIEW_ACCOUNT_UNMAPPED');
  return {code:row.code,ar:account.ar,en:account.en,kind:kind as Category,debit:row.final.debit,credit:row.final.credit,pending:row.pending};
 });
 const total=(kind:Category)=>lines.filter(r=>r.kind===kind).reduce((sum,r)=>sum.plus(r.debit).minus(r.credit),new Money(0)).times(kind==='ASSET'?1:-1).toFixed(4);
 const cash=lines.filter(row=>byCode.get(row.code)?.cash).reduce((sum,row)=>sum.plus(row.debit).minus(row.credit),new Money(0)).toFixed(4);
 return {
  organizationId:data.organizationId,fiscalStart:data.fiscalStart,currency:data.currency,draftId:workspace.id,draftVersion:workspace.version,
  sourceChanged:workspace.source_revision!==data.source.revision,balanced:new Money(state.totals.difference).isZero(),pending:state.pending,
  sourceIssues:data.source.rows.filter(row=>row.sourceIssue).length,debit:state.totals.debit,credit:state.totals.credit,
  assets:total('ASSET'),liabilities:total('LIABILITY'),equity:total('EQUITY'),cash,rows:lines,
 };
}
