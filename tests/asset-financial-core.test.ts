import {describe,expect,it} from 'vitest';
import {assetPurchaseFinancialClass,assetPurchaseSourceKey,buildAssetPurchaseCoreIntent} from '../lib/asset-financial-core';

describe('asset purchase financial core mapping',()=>{
 it('maps catalog classes to the approved financial classification',()=>{
  expect(assetPurchaseFinancialClass('PPE')).toBe('CAPEX');
  expect(assetPurchaseFinancialClass('INTANGIBLE')).toBe('CAPEX');
  expect(assetPurchaseFinancialClass('INVESTMENT')).toBe('INVESTMENT');
  expect(assetPurchaseFinancialClass('FINANCIAL')).toBe('ASSET');
  expect(assetPurchaseFinancialClass('INVENTORY')).toBe('ASSET');
  expect(assetPurchaseFinancialClass('OTHER')).toBe('ASSET');
 });
 it('uses the transaction id as a stable idempotency key and asset/source links',()=>{
  const p=buildAssetPurchaseCoreIntent({transactionId:'11111111-1111-4111-8111-111111111111',assetId:'22222222-2222-4222-8222-222222222222',organizationId:'33333333-3333-4333-8333-333333333333',entityId:null,costCenterId:null,assetName:'Vehicle',assetClassCode:'PPE',transactionDate:'2026-10-05',currency:'SAR',baseCurrency:'SAR',amount:100000,baseAmount:100000,exchangeRate:1,assetClassificationId:'44444444-4444-4444-8444-444444444444'});
  expect(p.source_event_key).toBe(assetPurchaseSourceKey('11111111-1111-4111-8111-111111111111'));
  expect(p.event_type).toBe('ASSET_PURCHASE');
  expect(p.lines).toHaveLength(1);
  expect(p.obligations[0].settleable_amount).toBe(100000);
  expect(p.links.map(x=>x.link_type)).toEqual(['SOURCE','ASSET']);
 });
 it('adds explicit VAT only when supplied and never invents it',()=>{
  const base={transactionId:'11111111-1111-4111-8111-111111111111',assetId:'22222222-2222-4222-8222-222222222222',organizationId:'33333333-3333-4333-8333-333333333333',entityId:null,costCenterId:null,assetName:'Machine',assetClassCode:'PPE',transactionDate:'2026-10-05',currency:'SAR',baseCurrency:'SAR',amount:100,baseAmount:100,exchangeRate:1,assetClassificationId:'44444444-4444-4444-8444-444444444444'};
  const noVat=buildAssetPurchaseCoreIntent(base); expect(noVat.lines).toHaveLength(1);expect(noVat.obligations[0].settleable_amount).toBe(100);
  const withVat=buildAssetPurchaseCoreIntent({...base,vatAmount:15,vatBaseAmount:15,taxClassificationId:'55555555-5555-4555-8555-555555555555'});expect(withVat.lines).toHaveLength(2);expect(withVat.obligations[0].settleable_amount).toBe(115);
 });
});
