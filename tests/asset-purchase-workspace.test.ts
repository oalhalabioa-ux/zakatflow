import {describe,it,expect} from 'vitest';
import {assetPurchaseAmounts,assetPurchasePrint,assetPurchaseStatus} from '../lib/asset-purchase-workspace';
describe('asset purchase workspace',()=>{
 it('prints both internal and supplier numbers without changing the amounts',()=>{const html=assetPurchasePrint({name:'Asset',currency:'SAR',metadata:{purchase_value:100,vat_amount:15,invoice_reference:'SUP-777'}},'DRAFT','Supplier',true,'PUR-2026-000003');expect(html).toContain('PUR-2026-000003');expect(html).toContain('SUP-777');expect(html).toContain('115.00 SAR')});
 it('calculates percentage VAT while preserving legacy amount VAT',()=>{expect(assetPurchaseAmounts(1200000,15,'PERCENT')).toEqual({net:1200000,tax:180000,gross:1380000});expect(assetPurchaseAmounts(1200000,15)).toEqual({net:1200000,tax:15,gross:1200015});expect(assetPurchaseAmounts(99.99,15,'PERCENT').tax).toBe(15)});
 it('rejects invalid rates and values',()=>{expect(()=>assetPurchaseAmounts(100,101,'PERCENT')).toThrow();expect(()=>assetPurchaseAmounts(-1,15)).toThrow()});
 it('prints escaped original currency and explicit draft status',()=>{const html=assetPurchasePrint({name:'<script>bad</script>',currency:'SAR',metadata:{purchase_value:100,vat_amount:15}},'DRAFT','Supplier');expect(html).not.toContain('<script>');expect(html).toContain('&lt;script&gt;');expect(html).toContain('115.00 SAR');expect(html).toContain(assetPurchaseStatus('DRAFT'))});
});
