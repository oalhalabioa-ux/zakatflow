import {describe,expect,it} from 'vitest';
import fs from 'node:fs';

describe('liquidity AR/AP operational safeguards',()=>{
 const liquidity=fs.readFileSync('app/api/liquidity/[id]/route.ts','utf8');
 const vat=fs.readFileSync('app/api/vat/route.ts','utf8');
 const ui=fs.readFileSync('components/LiquidityWorkspace.tsx','utf8');
 it('settles an existing obligation without recognizing revenue or expense again',()=>{
   const actual=liquidity.slice(liquidity.indexOf("if(body.status==='ACTUAL'"));
   expect(actual).toContain("event_type:'SETTLEMENT'");
   expect(actual).toContain('financial_event_obligation_balances');
   expect(actual).toContain('obligation_id:balances[0].obligation_id');
   expect(actual).not.toContain("event_type:'REVENUE'");
   expect(actual).not.toContain("event_type:'EXPENSE'");
 });
 it('supports partial settlement bounded by both cash flow and obligation outstanding',()=>{
   expect(liquidity).toContain('const requestedAmount=body.amount??flowOutstanding');
   expect(liquidity).toContain('Math.min(flowOutstanding,Number(requestedAmount))');
   expect(liquidity).toContain('Math.min(obligationOutstandingBase,Number(requestedBase))');
   expect(ui).toContain('Partial settlement is allowed; the remaining balance stays open.');
 });
 it('keeps invoice forecast idempotent and synchronizes due date before settlement',()=>{
   expect(vat).toContain('vat_documents:${document.id}:cash-forecast');
   expect(vat).toContain("settlement_status === 'UNSETTLED'");
   expect(vat).toContain('due_date: document.due_date');
   expect(vat).toContain("link_type: 'CASH_FLOW'");
 });
 it('allows manual confirmation at the main organization level without forcing a child entity',()=>{
   expect(liquidity).toContain('const entityId=body.entity_id??record.entity_id??null');
   expect(liquidity).not.toContain("if(!entityId)return NextResponse.json({error:'LIQUIDITY_FINANCIAL_ENTITY_REQUIRED'");
 });
 it('rejects recognition event type drift from the selected financial treatment',()=>{
   expect(liquidity).toContain('LIQUIDITY_RECOGNITION_TREATMENT_MISMATCH');
   expect(liquidity).toContain("existing.event_type!==eventType");
   expect(liquidity).toContain("treatment==='LIABILITY'||treatment==='FINANCING'?'LIABILITY':treatment==='EQUITY'?'ADJUSTMENT'");
 });
 it('keeps financing principal and equity out of revenue expense and receivables',()=>{
   expect(liquidity).toContain("FINANCING_PRINCIPAL_REPAYMENT_REQUIRES_EXISTING_PAYABLE");
   expect(liquidity).toContain("const obligationType=(treatment==='FINANCING'||treatment==='LIABILITY')?'PAYABLE'");
   expect(liquidity).toContain("const createsObligation=treatment!=='EQUITY'");
   expect(liquidity).toContain("obligations:createsObligation?");
   expect(liquidity).toContain("action:'POST_NONALLOCATING_CASH'");
   expect(liquidity).toContain("actualTreatment==='FINANCING'||actualTreatment==='EQUITY'");
 });
 it('posts an independently approved saved settlement instead of leaving it pending forever',()=>{
   expect(liquidity).toContain("action:'POST_SAVED_SETTLEMENT'");
   expect(liquidity).toContain("settlement_status:'SETTLED'");
   expect(liquidity).toContain("error:'SETTLEMENT_PENDING_APPROVAL'");


 });
 it('routes receivable payable and transfers away from new recognition',()=>{
   expect(liquidity).toContain("['RECEIVABLE','PAYABLE','TRANSFER'].includes(treatment)");
   expect(ui).toContain('Use Transfers for movements between cash accounts');
   expect(ui).toContain('settles an existing obligation');
 });
});
