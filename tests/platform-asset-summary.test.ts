import {describe,it,expect} from 'vitest';
import {platformAssetCategory,platformAssetSummary} from '../lib/platform-asset-summary';
const asset=(asset_class_code:string,asset_type_code:string,book=100,extra:any={})=>({ownership_scope:'ORGANIZATION',status:'ACTIVE',lifecycle_status:'ACTIVE',asset_class_code,asset_type_code,current_cost_value:book,current_market_value:book*2,metadata:{},...extra});
const liquidity={accounts:[{current_balance_base:1000,restricted_balance_base:200},{current_balance_base:-50}],counterparty_balances:[{receivable_balance:300}]};
describe('financial company asset indicators',()=>{
 it('uses book balances after approved depreciation and adds operational cash/receivables only once',()=>{
  const result=platformAssetSummary([asset('PPE','MACHINERY',80),asset('INTANGIBLE','SOFTWARE',50),asset('INVENTORY','GOLD',40),asset('FINANCIAL','BANK',1000),asset('FINANCIAL','RECEIVABLE',300)],liquidity);
  expect(result).toMatchObject({current:'1300.00',fixed:'80.00',intangible:'50.00',value:'1430.00',cash:'1000.00',excludedCount:3});
 });
 it('reports investments separately and excludes precious metals from company indicators',()=>{
  expect(platformAssetCategory(asset('INVESTMENT','INVESTMENT_PROPERTY'))).toBe('investment');
  expect(platformAssetSummary([asset('INVESTMENT','FUND',250),asset('INVENTORY','GOLD',40),asset('INVENTORY','SILVER',60)],liquidity)).toMatchObject({investment:'250.00',other:'0.00',otherCount:0,value:'1550.00',excludedCount:2});
 });
 it('excludes personal, sold and disposed assets',()=>{
  expect(platformAssetSummary([asset('PPE','BUILDING',100,{ownership_scope:'PERSONAL'}),asset('PPE','BUILDING',100,{lifecycle_status:'SOLD'}),asset('PPE','BUILDING',100,{lifecycle_status:'DISPOSED'})],liquidity)).toMatchObject({count:0,fixed:'0.00',value:'1300.00'});
 });
 it('uses saved market quotes with a disclosed book fallback',()=>{
  const rows=[asset('PPE','MACHINERY',100,{metadata:{market_price:20}}),asset('INTANGIBLE','SOFTWARE',50)];
  expect(platformAssetSummary(rows,liquidity,'MARKET')).toMatchObject({fixed:'200.00',intangible:'50.00',marketFallbackCount:1,value:'1550.00'});
  expect(platformAssetSummary(rows,liquidity,'BOOK')).toMatchObject({fixed:'100.00',intangible:'50.00',value:'1450.00'});
 });
 it('does not present a partial or unknown source as zero',()=>{
  expect(platformAssetSummary(null,liquidity)).toBeNull();
  expect(platformAssetSummary([],null)).toBeNull();
  expect(platformAssetSummary([asset('PPE','VEHICLE',100,{current_cost_value:undefined})],liquidity)).toBeNull();
 });
});
