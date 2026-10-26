import {expect,it} from 'vitest';
import {transactionVoucher,voucherNumber} from './voucher-identity';
it('uses persisted transaction type, not notes or backdated loan date, for opening classification',()=>{
 expect(transactionVoucher({id:'94fd6073-8dc1-4220-b6bb-fe603c6a4c6f',transaction_type:'OPENING_BALANCE'})).toMatchObject({voucherNumber:'OB-94FD60738DC1',voucherType:'رصيد افتتاحي',isOpening:true});
 expect(transactionVoucher({id:'loan',transaction_type:'ADD',metadata:{source:'PERSONAL_FINANCING',purpose:'FUNDING',kind:'LOAN'}})).toMatchObject({voucherType:'إضافة قرض مستلم',isOpening:false});
 expect(voucherNumber('4f1ea3df-93b9-4fbe-818c-e4db9241ff1b','AP')).toBe('AP-4F1EA3DF93B9');
});
it('keeps opening reversals out of actual receipt and payment totals',()=>{
 expect(transactionVoucher({id:'reverse',transaction_type:'REVERSAL'},{transaction_type:'OPENING_BALANCE'})).toMatchObject({voucherType:'عكس رصيد افتتاحي',isOpening:true});
});
