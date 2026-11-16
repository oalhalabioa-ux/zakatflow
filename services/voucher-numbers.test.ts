import {describe,it,expect} from 'vitest';
import {withVoucherNumbers} from './voucher-numbers';
import {sourceVoucher} from '../lib/source-voucher';
const a='4f1ea3df-93b9-4fbe-818c-e4db9241ff1b',b='94fd6073-8dc1-4220-b6bb-fe603c6a4c6f',loan='5141b419-e4e4-4403-bd26-be899399fe22';
const rows=[{source_id:a,source_table:'personal_payables',document_number:'OB-0035-26'},{source_id:b,source_table:'transactions',document_number:'OB-0036-26'},{source_id:loan,source_table:'personal_payables',document_number:'LR-0001-26'}];
const db=(failure=false)=>({from:(name:string)=>{expect(name).toBe('voucher_numbers');return {select:()=>({in:async(_column:string,ids:string[])=>failure?{error:new Error('denied')}:{data:rows.filter(r=>ids.includes(r.source_id)),error:null}})}}});
describe('voucher registry reads',()=>{
 it('attaches owned sequence by source, preserves invoice number and linked identifiers',async()=>{const input={items:[{id:a,voucherSourceId:a,voucherSourceTable:'personal_payables',voucherNumber:'old'},{id:b,transaction_id:loan},{id:a,voucherSourceId:a,voucherSourceTable:'personal_payables',voucherNumber:'INV-123',voucherOfficial:true}]};const result=await withVoucherNumbers(db(),input);expect(result.items[0].voucherNumber).toBe('OB-0035-26');expect((result.items[1] as any).document_links.transaction_id).toBe('LR-0001-26');expect(result.items[2].voucherNumber).toBe('INV-123');expect(input.items[0].voucherNumber).toBe('old');});
 it('fails closed on registry errors',async()=>{await expect(withVoucherNumbers(db(true),{id:a})).rejects.toThrow('denied')});
 it('uses the real sequence without replacing an official invoice number',()=>{expect(sourceVoucher('ASSET',{id:b,transaction_type:'OPENING_BALANCE',document_sequence:'OB-0036-26'}).voucherNumber).toBe('OB-0036-26');expect(sourceVoucher('INVOICE',{id:a,document_number:'INV-17',document_sequence:'SI-0001-26'}).voucherNumber).toBe('INV-17')});
});
