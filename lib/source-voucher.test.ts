import {describe,expect,it} from 'vitest';
import {sourceVoucher,voucherDomains} from './source-voucher';
const id='4f1ea3df-93b9-4fbe-818c-e4db9241ff1b';
describe('voucher identity for every document family',()=>{
 it('labels loan direction and participation from source fields while retaining persisted numbers',()=>{
  expect(sourceVoucher('DEBT',{id,kind:'LOAN',mode:'NEW',side:'PAYABLE',document_sequence:'LR-0001-26'})).toMatchObject({voucherType:'قرض دائن',voucherNumber:'LR-0001-26'});
  expect(sourceVoucher('DEBT',{id,kind:'LOAN',mode:'NEW',side:'RECEIVABLE'}).voucherType).toBe('قرض مدين');
  expect(sourceVoucher('PERSONAL_CONTRACT',{id,product:'PARTICIPATION',terms:{mode:'NEW'}}).voucherType).toBe('عقد مشاركة');
  expect(sourceVoucher('DEBT',{id,kind:'LOAN',mode:'OPENING',side:'PAYABLE'}).voucherType).toBe('رصيد افتتاحي');
 });
 it.each(voucherDomains)('%s keeps its identity independent of editable reference and ownership scope',domain=>{
  const row={id,kind:'FUND',transaction_type:'OPENING_BALANCE',instrument:'DEPOSIT',direction:'INFLOW',status:'ACTUAL',reference:'External 1',organization_id:null};
  const personal=sourceVoucher(domain,row),corporate=sourceVoucher(domain,{...row,reference:'External 2',organization_id:'company'});
  expect(personal.voucherNumber).toBeTruthy();expect(personal.voucherType).toBeTruthy();expect(corporate).toEqual(personal);
  expect(sourceVoucher(domain,{...row,id:undefined}).voucherNumber).toBe('');
 });
 it('keeps official invoice and purchase numbers and correctly distinguishes credit and debit notes',()=>{
  expect(sourceVoucher('INVOICE',{id,document_type:'PURCHASE',document_kind:'CREDIT_NOTE',purchase_number:'PUR-100',document_number:'Supplier note 5'})).toMatchObject({voucherNumber:'PUR-100',voucherType:'إشعار دائن'});
  expect(sourceVoucher('INVOICE',{id,document_type:'SALES',document_kind:'DEBIT_NOTE',document_number:'DN-13'})).toMatchObject({voucherNumber:'DN-13',voucherType:'إشعار مدين'});
  expect(sourceVoucher('ASSET',{id,transaction_type:'PURCHASE',purchase_number:'PUR-101',reference:'supplier-9'}).voucherNumber).toBe('PUR-101');
 });
 it('does not describe an unexecuted flow as an actual receipt',()=>{
  expect(sourceVoucher('CASH_FLOW',{id,direction:'INFLOW',status:'EXPECTED'}).voucherType).toBe('تدفق قبض مخطط');
  expect(sourceVoucher('CASH_FLOW',{id,direction:'INFLOW',status:'ACTUAL'}).voucherType).toBe('تدفق قبض منفذ');
  expect(sourceVoucher('CASH_SETTLEMENT',{id:'settlement',financial_event_id:id,direction:'INFLOW'}).voucherNumber).toBe(sourceVoucher('EVENT',{id}).voucherNumber);
 });
 it('uses source mode for opening vouchers rather than matching wording or amount',()=>{
  expect(sourceVoucher('DEBT',{id,mode:'OPENING',kind:'LOAN'}).voucherType).toBe('رصيد افتتاحي');
  expect(sourceVoucher('DEBT',{id,mode:'NEW',kind:'LOAN',description:'رصيد افتتاحي'}).voucherType).toBe('عقد قرض');
 });
});
