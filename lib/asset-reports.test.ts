import {describe,it,expect} from 'vitest';
import {assetReportValuation,filterReportAssets,reportAssetTotals,filterReportMovements,postedReportMovements} from './asset-reports';
const date='2026-11-22';
const market=(value:number)=>({asset_type:'OTHER',current_quantity:1,metadata:{
 market_price_per_unit:value,market_price_source:'USER_MANUAL',market_valuation_date:'2026-11-21',
}});
const filter={scope:'ORGANIZATION',organizationId:'one',entityId:'',query:'',category:'',status:''};
describe('asset financial reports',()=>{
 it('recognizes funded investment assets once, excluding investment drafts',()=>{const totals=reportAssetTotals([{currency:'SAR',metadata:{investment_id:'draft',investment_status:'DRAFT'},current_cost_value:0},{currency:'SAR',metadata:{investment_id:'active',investment_status:'ACTIVE'},current_cost_value:100,current_market_value:100}],date);expect(totals.drafts).toBe(1);expect(totals.recognized).toBe(1);expect(totals.groups[0].cost).toBe(100);});
 it('isolates organization and entity without mixing personal assets',()=>{const assets=[{id:1,organization_id:'one',entity_id:'branch'},{id:2,organization_id:'two'},{id:3}];expect(filterReportAssets(assets,{...filter,entityId:'branch'}).map(a=>a.id)).toEqual([1]);expect(filterReportAssets(assets,{...filter,scope:'PERSONAL'}).map(a=>a.id)).toEqual([3]);});
 it('excludes drafts, separates currencies, and preserves assessed Zakat',()=>{
  const totals=reportAssetTotals([
   {...market(130),financial_event_status:'ACTUAL',currency:'SAR',current_cost_value:100,zakat_calculation:{currency:'USD',zakat_amount:10}},
   {...market(1000),financial_event_status:'DRAFT',currency:'SAR',current_cost_value:900},
   {...market(10),currency:'USD',current_cost_value:20,zakat_calculation:{currency:'USD',eligible_value:25,zakat_amount:0.625}},
  ],date);
  expect(totals.drafts).toBe(1);
  expect(totals.groups.map(g=>[g.currency,g.cost,g.gain,g.eligible,g.zakat])).toEqual([['SAR',100,30,0,0],['USD',20,-10,25,0.625]]);
 });
 it('shows partial market coverage and never uses an acquisition or book fallback as a market price',()=>{
  const priced={...market(410),asset_type:'GOLD',currency:'SAR',current_quantity:8,current_cost_value:2400};
  priced.metadata={...priced.metadata,...{karat:18,market_value_auto:true,market_price_source:'MANUAL_MARKET_PRICE'}};
  const opening={...market(400),currency:'SAR',current_cost_value:400,current_market_value:400,
   metadata:{...market(400).metadata,market_price_source:'ACQUISITION_COST'}};
  expect(assetReportValuation(priced,date)).toMatchObject({value:'2460',unrealized:'60',appliedPrice:'307.5'});
  expect(assetReportValuation(opening,date)).toBeNull();
  expect(reportAssetTotals([priced,opening],date).groups[0]).toMatchObject({
   count:2,valued:1,cost:2800,market:2460,gain:60,percent:2.5,
  });
  expect(reportAssetTotals([opening],date).groups[0]).toMatchObject({cost:400,market:null,gain:null,percent:null});
 });
 it('uses only the stored valuation FX and rejects undated quotations',()=>{
  const holding={...market(10),currency:'USD',current_value_currency:'SAR',current_cost_value:30};
  expect(assetReportValuation({...holding,metadata:{...holding.metadata,fx_rate:3.75}},date)).toBeNull();
  expect(assetReportValuation({...holding,metadata:{...holding.metadata,market_fx_rate:3.75}},date)).toMatchObject({value:'37.5'});
  expect(assetReportValuation({...holding,metadata:{...holding.metadata,market_fx_rate:3.75,market_valuation_date:null}},date)).toBeNull();
 });
 it('filters movements inclusively and excludes unposted/reversed records from totals',()=>{const rows=[{id:1,asset_account_id:'a',transaction_date:'2026-10-13',financial_event_status:'ACTUAL'},{id:2,asset_account_id:'a',transaction_date:'2026-10-13',financial_event_status:'DRAFT'},{id:3,asset_account_id:'b',transaction_date:'2026-10-13'},{id:4,asset_account_id:'a',transaction_date:'2026-10-12',metadata:{lifecycle_reversed:true}}];expect(filterReportMovements(rows,[{id:'a'}],'2026-10-13','2026-10-13').map(r=>r.id)).toEqual([1,2]);expect(postedReportMovements(rows).map(r=>r.id)).toEqual([1,3]);});
});
