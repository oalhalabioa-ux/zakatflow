import {describe,it,expect} from 'vitest';
import {assetPurchaseInvoices,type AssetInvoiceTransaction,type AssetInvoiceEvent} from './asset-invoice-source';
const t:AssetInvoiceTransaction={id:'purchase',organization_id:'org',asset_account_id:'asset',transaction_type:'PURCHASE',transaction_date:'2026-10-01',reference:'SUP-1',currency:'USD',base_currency:'SAR',gross_value:100,base_value:375,metadata:{financial_event_id:'event',vat_amount:15,fx_rate:3.75,recoverable_percent:50}};
const e:AssetInvoiceEvent={id:'event',organization_id:'org',source_module:'ASSETS_INTEGRATION',source_record_id:'purchase',status:'ACTUAL',counterparty_id:'supplier',due_date:'2026-11-01'};
const parties=[{id:'supplier',organization_id:'org',name:'Vendor'}];
describe('automatic asset purchase invoice projection',()=>{
 it('preserves invoice net, VAT and gross in source/base currencies even with partially capitalized VAT',()=>{expect(assetPurchaseInvoices([t],[e],parties,[])[0]).toMatchObject({reference:'SUP-1',partyName:'Vendor',net:100,tax:15,total:115,baseNet:375,baseTax:56.25,baseTotal:431.25,due:'2026-11-01'})});
 it('does not duplicate an existing VAT alias, regardless of its register page',()=>{expect(assetPurchaseInvoices([t],[e],parties,[{organization_id:'org',asset_transaction_id:'purchase'}])).toEqual([])});
 it('does not hide a transaction because of an alias in another organization',()=>{expect(assetPurchaseInvoices([t],[e],parties,[{organization_id:'other',asset_transaction_id:'purchase'}])).toHaveLength(1)});
 it('excludes opening balances, incomplete invoices, deleted entries and cancellation mirrors',()=>{for(const invalid of [{transaction_type:'OPENING_BALANCE'},{reference:null},{metadata:{...t.metadata,asset_deleted:true}},{reversal_of_transaction_id:'original'}])expect(assetPurchaseInvoices([{...t,...invalid}],[e],parties,[])).toEqual([])});
 it('requires the actual asset source identity and organization',()=>{for(const invalid of [{organization_id:'other'},{source_record_id:'other'},{source_module:'VAT_INTEGRATION'},{status:'CANCELLED'}])expect(assetPurchaseInvoices([t],[{...e,...invalid}],parties,[])).toEqual([])});
 it('keeps pending invoices for the register with their true accounting status',()=>{expect(assetPurchaseInvoices([t],[{...e,status:'COMMITTED'}],parties,[])[0].accountingStatus).toBe('COMMITTED')});
});
