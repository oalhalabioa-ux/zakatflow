import {describe,it,expect} from 'vitest';
import {assetLedgerBalance,assetZakatPayments} from '../lib/asset-ledger';
import {assetCostValue,sortAssetRows} from '../lib/asset-table-preferences';
import {frozenLotValuation,nisabFromPrice} from '../lib/zakat-valuation';
const asset={id:'a',asset_type:'GOLD',currency:'SAR',metadata:{quantity:100,purchase_value:30000,market_price:350,karat:21}};
const lots=[{id:'lot',asset_account_id:'a',original_quantity:100,remaining_quantity:60,remaining_value_base:18000,asset_accounts:asset,hawl_start_date:'2025-01-01'}];
describe('asset ledger and cycle snapshots',()=>{
 it('uses residual quantity/cost after a partial sale in table and totals',()=>{
  const balance=assetLedgerBalance(asset,lots);expect(balance.current_quantity).toBe(60);expect(balance.current_cost_value).toBe(18000);expect(balance.current_market_value).toBe(21000);
  expect(assetCostValue({...asset,...balance})).toBe(18000);
  expect(sortAssetRows([{id:'b',current_quantity:70,metadata:{quantity:1}},{id:'a',...balance,metadata:{quantity:100}}],'weight','asc')[0].id).toBe('a');
 });
 it('does not double-count one account market value across multiple lots',()=>{
  const stock={id:'a',asset_type:'STOCK',currency:'SAR',metadata:{market_value:10000}};
  const multiple=[{asset_account_id:'a',original_quantity:50,remaining_quantity:20,remaining_value_base:2000},{asset_account_id:'a',original_quantity:50,remaining_quantity:50,remaining_value_base:5000}];
  expect(assetLedgerBalance(stock,multiple).current_market_value).toBe(7000);
  expect(multiple.reduce((sum,lot)=>sum+frozenLotValuation({...lot,asset_accounts:stock},multiple,'SAR',{}).marketValueBase.toNumber(),0)).toBe(7000);
 });
 it('cash value follows remaining ledger balance, never stale metadata',()=>{
  expect(assetLedgerBalance({...asset,asset_type:'BANK'},lots).current_market_value).toBe(18000);
 });
 it('excludes payments from earlier cycles but retains same-cycle revision payments',()=>{
  const payments=[{assessment_id:'old',hawl_cycle_id:'prior',lot_id:'lot',asset_account_id:'a',allocated_amount:2500},{assessment_id:'v1',hawl_cycle_id:'current',lot_id:'lot',asset_account_id:'a',allocated_amount:200}];
  const p=assetZakatPayments(payments,{id:'v2',hawl_cycle_id:'current'});expect(p.currentByLot.get('lot')).toBe(200);expect(p.historicalByAsset.get('a')).toBe(2700);
 });
 it('legacy assessments without cycles only credit their own payments',()=>{
  const p=assetZakatPayments([{assessment_id:'v1',lot_id:'lot',asset_account_id:'a',allocated_amount:300}],{id:'v2',hawl_cycle_id:null});expect(p.currentByLot.size).toBe(0);
 });
 it('captures price, source, purity and FX independently of later market changes',()=>{
  const prices={GOLD:{price:100,currency:'USD',fxRate:3.75,source:'MANUAL'}};
  const v=frozenLotValuation(lots[0],lots,'SAR',prices);
  expect(v.marketValueBase.toNumber()).toBe(19687.5);expect(v.valuationSnapshot.purity).toBe('0.875');expect(v.valuationCurrency).toBe('USD');
  prices.GOLD.price=200;asset.metadata.karat=24;
  expect(v.marketValueBase.toNumber()).toBe(19687.5);expect(v.valuationSnapshot.unitPrice).toBe('100');expect(v.valuationSnapshot.purity).toBe('0.875');asset.metadata.karat=21;
 });
 it('applies FX to Nisab as well as metal valuation',()=>{
  expect(nisabFromPrice('GOLD',{GOLD:{price:100,currency:'USD',fxRate:3.75,source:'MANUAL'}}).toNumber()).toBe(31875);
 });
 it('requires a price for each held metal rather than silently falling back to acquisition cost',()=>{
  expect(()=>frozenLotValuation(lots[0],lots,'SAR',{})).toThrow('GOLD_VALUATION_PRICE_REQUIRED');
 });
 it('rejects invalid purity and missing foreign-currency valuation FX',()=>{
  expect(()=>frozenLotValuation({...lots[0],asset_accounts:{...asset,metadata:{karat:25}}},lots,'SAR',{GOLD:{price:300,currency:'SAR',fxRate:1,source:'MANUAL'}})).toThrow('ASSET_PURITY_INVALID');
  expect(()=>frozenLotValuation({...lots[0],asset_accounts:{...asset,asset_type:'STOCK',currency:'USD',metadata:{market_price:10}}},lots,'SAR',{})).toThrow('ASSET_VALUATION_FX_RATE_REQUIRED');
 });
});
