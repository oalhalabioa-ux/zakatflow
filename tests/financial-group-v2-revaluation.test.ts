import {expect,it} from 'vitest';
import {crossCurrencyFixture} from '../app/design-preview/financial-reports/group-acceptance/verified-scenario';
import {normalizeStatementSource} from '../lib/financial-statement-source';
import {reviewV2Revaluation} from '../lib/financial-group-v2-revaluation';

it('matches the original and later reversal only within their respective ledger cuts',()=>{
 const f=crossCurrencyFixture(true),[company]=f.sources,[,adjustment,reversal]=company.events;
 const cutoff=adjustment.date,after=reversal.date;
 const [originalLine]=adjustment.lines,[reversalLine]=reversal.lines;
 const rule=company.policy.rules[1];
 adjustment.eventType=rule.eventType='ADJUSTMENT';
 reversal.eventType='REVERSAL';
 company.policy.rules.push({...rule,id:'fx-reversal-rule',eventType:'REVERSAL'});
 const finance=rule.debitAccountId,debt=rule.creditAccountId;
 rule.debitAccountId=debt;rule.creditAccountId=finance;
 company.policy.rules.at(-1)!.debitAccountId=debt;company.policy.rules.at(-1)!.creditAccountId=finance;
 originalLine.baseAmount=reversalLine.baseAmount='15.0000';
 const parts=(event:{id:string;date:string},lineId:string,baseAmount:string)=>({journalId:event.id,lineId:lineId.split(':')[0],date:event.date,
  baseAmount,debtAccountId:debt,debtSide:'CREDIT'});
 const claim={basis:'POSTED_V2_LINEAGE',asOf:cutoff,canonicalLineId:originalLine.id,reversal:null,
  evidence:{organization_id:company.organizationId,journal_id:adjustment.id,line_id:originalLine.id.split(':')[0],
   obligation_id:'82000000-0000-4000-8000-000000000004',document_id:'82000000-0000-4000-8000-000000000005',
   document_module:'debt_contracts',debt_account_id:debt,debt_side:'DEBIT',offset_account_id:finance,posting_rule_id:rule.id,
   cutoff,posted_base_amount:'15.0000',quote_evidence:{quoteId:'82000000-0000-4000-8000-000000000006',quoteDate:cutoff,rate:'3.9'}}};
 const snapshot=(to:string)=>normalizeStatementSource({...company,to},{organization:company.organizationId,from:company.from,to},true);
 const earlier=reviewV2Revaluation(claim,snapshot(cutoff));
 expect(earlier).toMatchObject({status:'V2_REVALUATION_LEDGER_MATCHED',debtMovement:'15.0000',offsetMovement:'-15.0000',reversal:null});
 const proof={...claim,asOf:after,reversal:parts(reversal,reversalLine.id,'15.0000')};
 const current=reviewV2Revaluation(proof,snapshot(after));
 expect(current).toMatchObject({debtMovement:'0.0000',offsetMovement:'0.0000',reversal:{journalId:reversal.id}});
 expect(()=>reviewV2Revaluation({...proof,reversal:null},snapshot(after))).toThrow('GROUP_V2_REVALUATION_LEDGER_MISMATCH');
 expect(()=>reviewV2Revaluation({...claim,evidence:{...claim.evidence,posted_base_amount:'150'}},snapshot(cutoff))).toThrow('GROUP_V2_REVALUATION_LEDGER_MISMATCH');
});
