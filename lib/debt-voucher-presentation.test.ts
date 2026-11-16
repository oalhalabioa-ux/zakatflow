import {describe,expect,it} from 'vitest';
import type {DebtItem} from './financial-register';
import {debtVoucherNumber,debtVoucherType,matchesDebtVoucher} from './debt-voucher-presentation';
const debt=(overrides:Partial<DebtItem>={}):DebtItem=>({id:'debt-id',partyKey:'party',partyName:'جهة تجريبية',organizationId:null,entityId:null,side:'PAYABLE',currency:'SAR',amount:500,dueDate:null,date:'2026-10-28',description:'حركة تمويل',source:'PERSONAL_PAYABLE',eventId:null,voucherType:'إضافة قرض مستلم',voucherNumber:'LR-0001-26',rawReference:'BANK-42',...overrides});
describe('separate debt voucher presentation and lookup',()=>{
 it('uses the source opening flag instead of inferring an opening from the description',()=>{
  expect(debtVoucherType(debt({isOpening:true}))).toBe('رصيد افتتاحي');
  expect(debtVoucherType(debt({description:'رصيد افتتاحي'}))).toBe('قرض دائن');
 });
 it('distinguishes loan direction while preserving other document families',()=>{
  expect(debtVoucherType(debt())).toBe('قرض دائن');
  expect(debtVoucherType(debt({side:'RECEIVABLE',voucherType:'إضافة قرض ممنوح'}))).toBe('قرض مدين');
  expect(debtVoucherType(debt({voucherType:'عقد استثمار ومشاركة'}))).toBe('عقد مشاركة');
  expect(debtVoucherType(debt({voucherType:'إثبات تكلفة تمويل'}))).toBe('إثبات تكلفة تمويل');
 });
 it('finds a row independently by persisted number, type or external reference',()=>{
  const row=debt();
  for(const query of ['lr-0001-26',' قرض دائن ','bank-42','جهة تجريبية'])expect(matchesDebtVoucher(row,query)).toBe(true);
  expect(matchesDebtVoucher(row,'قرض مدين')).toBe(false);
  expect(matchesDebtVoucher(row,'')).toBe(true);
 });
 it('does not replace the persisted number with an editable external reference or mutate the debt',()=>{
  const row=debt(),before={...row};
  expect(debtVoucherNumber(row)).toBe('LR-0001-26');
  expect(debtVoucherNumber({...row,rawReference:'NEW-REFERENCE'})).toBe('LR-0001-26');
  debtVoucherType(row);matchesDebtVoucher(row,'قرض');expect(row).toEqual(before);
 });
});
