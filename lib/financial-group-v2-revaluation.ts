import Decimal from 'decimal.js';
import {z} from 'zod';
import type {StatementSourceSnapshot} from './financial-statement-source';

const uuid=z.string().uuid(),date=z.string().date(),amount=z.union([z.string(),z.number()]);
export const postedV2Revaluation=z.object({
 basis:z.literal('POSTED_V2_LINEAGE'),asOf:date,canonicalLineId:z.string().min(1),
 evidence:z.object({organization_id:uuid,journal_id:uuid,line_id:uuid,obligation_id:uuid,document_id:uuid,
  document_module:z.string().min(1),debt_account_id:z.string().min(1),debt_side:z.enum(['DEBIT','CREDIT']),
  offset_account_id:z.string().min(1),posting_rule_id:z.string().min(1),cutoff:date,posted_base_amount:amount,
  quote_evidence:z.object({quoteId:uuid,quoteDate:date,rate:amount})}),
 reversal:z.object({journalId:uuid,lineId:uuid,date,baseAmount:amount,debtAccountId:z.string().min(1),debtSide:z.enum(['DEBIT','CREDIT'])}).nullable(),
});

/** Reconciles the evidence RPC with the already compiled company ledger. */
export function reviewV2Revaluation(lineage:unknown,snapshot:StatementSourceSnapshot){
 const source=postedV2Revaluation.parse(lineage),link=source.evidence,{statements,periodLedger}=snapshot;
 const invalid=()=>{throw Error('GROUP_V2_REVALUATION_LEDGER_MISMATCH');};
 if(snapshot.origin!=='LIVE_CANONICAL_EVENTS'||snapshot.scope!=='ORGANIZATION_ALL_ENTITIES'||!periodLedger||
  statements.organizationId!==link.organization_id||source.asOf!==statements.to||link.cutoff<statements.from||link.cutoff>statements.to||
  link.debt_account_id===link.offset_account_id||source.canonicalLineId!==link.line_id+':BASE'||
  !snapshot.lineage.some(row=>row.eventId===link.journal_id&&row.lineId===source.canonicalLineId&&row.ruleId===link.posting_rule_id))return invalid();
 const debt=periodLedger.accounts.find(row=>row.id===link.debt_account_id);
 const offset=periodLedger.accounts.find(row=>row.id===link.offset_account_id);
 const original=new Decimal(link.posted_base_amount).times(link.debt_side==='DEBIT'?1:-1);
 const originalAmount=new Decimal(link.posted_base_amount);
 const reversed=source.reversal;
 if(!originalAmount.isFinite()||!originalAmount.gt(0)||!debt||!offset||
  snapshot.cashMovements.some(row=>row.id===link.journal_id||row.id===reversed?.journalId))return invalid();
 const matched=(id:string,on:string,signed:Decimal,originalId?:string)=>{
  const a=debt.entries.filter(row=>row.journalId===id),b=offset.entries.filter(row=>row.journalId===id);
  return a.length===1&&b.length===1&&a[0].date===on&&b[0].date===on&&a[0].reversesJournalId===originalId&&
   b[0].reversesJournalId===originalId&&new Decimal(a[0].debit).minus(a[0].credit).eq(signed)&&
   new Decimal(b[0].debit).minus(b[0].credit).eq(signed.negated());
 };
 if(!matched(link.journal_id,link.cutoff,original))return invalid();
 const reversals=debt.entries.filter(row=>row.reversesJournalId===link.journal_id);
 if(reversals.length!==(reversed?1:0)||reversed&&(reversed.date<link.cutoff||reversed.date>source.asOf||
  reversed.debtAccountId!==link.debt_account_id||reversed.debtSide===link.debt_side||
  !snapshot.lineage.some(row=>row.eventId===reversed.journalId&&row.lineId===reversed.lineId+':BASE')||
  !new Decimal(reversed.baseAmount).eq(originalAmount)||!matched(reversed.journalId,reversed.date,original.negated(),link.journal_id)))return invalid();
 const movement=reversed?new Decimal(0):original;
 return {status:'V2_REVALUATION_LEDGER_MATCHED' as const,asOf:source.asOf,companyCurrency:statements.currency,
  journalId:link.journal_id,lineId:source.canonicalLineId,obligationId:link.obligation_id,documentId:link.document_id,
  documentModule:link.document_module,cutoff:link.cutoff,debtAccountId:link.debt_account_id,offsetAccountId:link.offset_account_id,
  sourceQuote:link.quote_evidence,reversal:reversed,debtMovement:movement.toFixed(4),offsetMovement:movement.negated().toFixed(4)};
}
