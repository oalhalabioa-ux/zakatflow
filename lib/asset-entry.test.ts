import {describe,it,expect} from 'vitest';
import {assetEntryTax,assetEntryAmount,financialOpeningFromAsset} from './asset-entry';
describe('asset entry commands',()=>{
 it('does not leak hidden purchase VAT into any opening asset',()=>{for(const net of [1,1000,100000])for(const mode of ['PERCENT','AMOUNT'] as const)expect(assetEntryTax('OPENING_BALANCE',net,mode,15,99)).toBe(0);});
 it('does not charge hidden company VAT on personal purchases',()=>{expect(assetEntryTax('PURCHASE',1000,'PERCENT',15,99,'PERSONAL')).toBe(0);});
 it('retains purchase VAT calculation',()=>{expect(assetEntryTax('PURCHASE',1000,'PERCENT',15,0)).toBe(150);expect(assetEntryTax('PURCHASE',1000,'AMOUNT',15,75)).toBe(75);});
 it('always uses Latin digits',()=>{const value=assetEntryAmount(100000,'SAR');expect(value).toBe('100,000.00 SAR');expect(value).not.toMatch(/[٠-٩]/);});
 it('adapts to the same register opening command without VAT or cash settlement fields',()=>{const p=financialOpeningFromAsset({name:'Cash',asset_type:'CASH',currency:'SAR',ownership_scope:'PERSONAL',metadata:{purchase_value:100,purchase_date:'2026-10-20',fx_rate:1,vat_rate:15,vat_amount:15}},'request');expect(p).toMatchObject({type:'CASH',opening_balance:100,scope:'PERSONAL',opening_date:'2026-10-20',hawl_start_date:'2026-10-20'});expect(p).not.toHaveProperty('vat_amount');expect(p).not.toHaveProperty('funding_account_id');});
});
