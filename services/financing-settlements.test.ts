import {beforeEach,it,expect,vi} from 'vitest';
const mock=vi.hoisted(()=>({context:vi.fn(),action:vi.fn()}));
vi.mock('./financing-contracts',()=>({financeContext:mock.context,financePermissions:vi.fn(),financeRows:vi.fn(),eventReview:vi.fn(),unwrap:(r:any)=>{if(r.error)throw Error(r.error.message);return r.data;}}));
vi.mock('./financial-events',()=>({executeFinancialEventAction:mock.action}));
import {financingSettlementAction} from './financing-settlements';
import {financialEventActionSchema} from '../lib/financial-event-command';
const id=(n:number)=>'10000000-0000-4000-8000-'+String(n).padStart(12,'0');
const org=id(1),contract=id(2),bank=id(3),principal=id(4),charge=id(5),payable=id(6);
let tables:Record<string,any[]>;
const command={action:'PREPARE_INSTALLMENT',organization_id:org,contract_id:contract,number:1,request_id:id(7),account_id:bank,date:'2026-10-01',principal_amount:40,finance_amount:20,reason:'Partial installment'};
beforeEach(()=>{
 vi.resetAllMocks();tables={
  debt_contracts:[{id:contract,organization_id:org,side:'PAYABLE',event_date:'2026-01-01',financial_event_id:principal,exchange_rate:1,currency:'SAR',entity_id:null,counterparty_id:id(8),reference:'Loan'}],
  financing_contract_terms:[{id:contract,organization_id:org,product:'FINANCING',plan:[{number:1,due_date:'2026-10-01'}]}],
  financial_events:[{id:charge,organization_id:org,status:'ACTUAL',event_date:'2026-10-01'}],
  financing_charge_events:[{organization_id:org,contract_id:contract,installment_number:1,financial_event_id:charge}],
  liquidity_accounts:[{id:bank,organization_id:org,active:true,currency:'SAR',entity_id:null}],
  financial_event_obligation_balances:[{obligation_id:id(9),organization_id:org,event_id:principal,obligation_key:'installment:1',outstanding_base_amount:50},{obligation_id:id(10),organization_id:org,event_id:charge,outstanding_base_amount:20}],
  organizations:[{id:org,base_currency:'SAR'}],
  financial_classifications:[{id:id(11),organization_id:org,classification_type:'PAYABLE',code:'ADVANCE_PAYABLE_CLEARING',active:true},{id:payable,organization_id:org,classification_type:'PAYABLE',code:'PAYABLE',active:true}],
 };
 const from=(table:string)=>{let rows=[...(tables[table]??[])],single=false,optional=false;const q:any={select:()=>q,eq:(k:string,v:any)=>{rows=rows.filter(r=>r[k]===v);return q;},is:(k:string,v:any)=>{rows=rows.filter(r=>(k.split('->').reduce((o,p)=>o?.[p],r)??null)===v);return q;},in:(k:string,v:any[])=>{rows=rows.filter(r=>v.includes(r[k]));return q;},limit:(n:number)=>{rows=rows.slice(0,n);return q;},single:()=>{single=true;return q;},maybeSingle:()=>{single=true;optional=true;return q;},then:(resolve:any,reject:any)=>Promise.resolve({data:single?rows[0]??null:rows,error:single&&!optional&&!rows.length?{message:'NOT_FOUND'}:null}).then(resolve,reject)};return q;};
 mock.context.mockResolvedValue({supabase:{from,rpc:async()=>({data:id(12),error:null})},user:{id:id(13)}});
 mock.action.mockImplementation(async(input:any)=>{financialEventActionSchema.parse(input);return id(14);});
});
it('creates separate principal and charge source lines with the exact generic payable classification',async()=>{
 await financingSettlementAction(command);
 const payload=mock.action.mock.calls.find(([c])=>c.action==='CREATE')![0].payload;
 expect(payload.lines.map((l:any)=>[l.classification_id,l.amount,l.metadata.source_role,l.metadata.settlement_obligation_id])).toEqual([[payable,40,'FINANCE_PRINCIPAL_PAYMENT',id(9)],[payable,20,'FINANCE_CHARGE_PAYMENT',id(10)]]);
 expect(payload.links[0].metadata.allocations.map((a:any)=>a.base_amount)).toEqual([40,20]);
 expect(payload.lines.reduce((n:number,l:any)=>n+l.base_amount,0)).toBe(payload.links[0].metadata.base_amount);
});
it('does not use an advance-clearing classification when the canonical payable is missing',async()=>{tables.financial_classifications.pop();await expect(financingSettlementAction(command)).rejects.toThrow('FINANCE_SETTLEMENT_CLASSIFICATION_REQUIRED');expect(mock.action).not.toHaveBeenCalled();});
it('rejects amounts exceeding the charge obligation before creating the request',async()=>{await expect(financingSettlementAction({...command,finance_amount:21})).rejects.toThrow('SETTLEMENT_EXCEEDS_OUTSTANDING');expect(mock.action).not.toHaveBeenCalled();});

it('prepares collection parts for a receivable financing contract with scoped metadata',async()=>{
 tables.debt_contracts[0].side='RECEIVABLE';tables.financial_classifications=[{id:payable,organization_id:org,classification_type:'RECEIVABLE',code:'RECEIVABLE',active:true}];
 await financingSettlementAction(command);
 const payload=mock.action.mock.calls.find(([c])=>c.action==='CREATE')![0].payload;
 expect(payload.lines.every((l:any)=>l.cash_direction==='INFLOW')).toBe(true);
 expect(()=>financialEventActionSchema.parse({action:'CREATE',payload:{...payload,source_module:'OTHER'}})).toThrow('FINANCE_SOURCE_METADATA_SCOPE_REQUIRED');
 expect(()=>financialEventActionSchema.parse({action:'CREATE',payload:{...payload,lines:payload.lines.map((l:any)=>({...l,metadata:{...l.metadata,recognition_sign:-1}}))}})).toThrow();
});
