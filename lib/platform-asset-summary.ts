import Decimal from 'decimal.js';

export type PlatformAssetBasis='BOOK'|'MARKET';
const cashTypes=['CASH','BANK'];
const receivableTypes=['RECEIVABLE','LOAN_RECEIVABLE','OTHER_RECEIVABLE'];
/** Financial display only. Persisted classifications, lots and Zakat are untouched. */
export function platformAssetCategory(a:any):'current'|'fixed'|'intangible'|'other' {
 const type=a.asset_type_code??a.asset_type;
 if(a.asset_class_code==='INVENTORY')return 'current';
 if(a.asset_class_code==='PPE')return 'fixed';
 if(a.asset_class_code==='INTANGIBLE')return 'intangible';
 if(['RAW_MATERIAL','WORK_IN_PROGRESS','FINISHED_GOODS','TRADING_INVENTORY','INVENTORY','PREPAYMENT','ADVANCE'].includes(type))return 'current';
 if(['LAND','BUILDING','VEHICLE','MACHINERY','FURNITURE','IT_EQUIPMENT'].includes(type))return 'fixed';
 if(['SOFTWARE','LICENSE','TRADEMARK','GOODWILL'].includes(type))return 'intangible';
 // Investments and unclassified metals need their actual purpose/maturity;
 // investment property must not silently become PPE.
 return 'other';
}
export function platformAssetSummary(rows:any[]|null,liquidity:any|null,basis:PlatformAssetBasis='BOOK') {
 if(!rows||!liquidity)return null;
 const active=rows.filter(a=>a.ownership_scope==='ORGANIZATION'&&a.status==='ACTIVE'&&a.lifecycle_status==='ACTIVE');
 const cash=liquidity.accounts.reduce((s:Decimal,a:any)=>s.add(Decimal.max(0,a.current_balance_base??0)),new Decimal(0));
 const receivables=liquidity.counterparty_balances.reduce((s:Decimal,a:any)=>s.add(Decimal.max(0,a.receivable_balance??0)),new Decimal(0));
 const groups={current:cash.add(receivables),fixed:new Decimal(0),intangible:new Decimal(0),other:new Decimal(0)};
 let otherCount=0,excludedCount=0,marketFallbackCount=0;
 for(const a of active){
  const type=a.asset_type_code??a.asset_type;
  // Operational balances are authoritative, even when empty: do not add the
  // same bank/receivable account a second time from the asset register.
  if([...cashTypes,...receivableTypes].includes(type)){excludedCount++;continue;}
  const category=platformAssetCategory(a);
  const quote=a.metadata?.market_price_per_unit??a.metadata?.market_price;
  const marketKnown=!a.valuation_fx_missing&&(Number(quote)>0||a.metadata?.market_value!=null||a.metadata?.estimated_value!=null);
  const value=basis==='MARKET'&&marketKnown?a.current_market_value:a.current_cost_value;
  if(value==null||!Number.isFinite(Number(value)))return null;
  if(basis==='MARKET'&&!marketKnown)marketFallbackCount++;
  groups[category]=groups[category].add(value);
  if(category==='other')otherCount++;
 }
 return {basis,count:active.length,cash:cash.toFixed(2),receivables:receivables.toFixed(2),
  current:groups.current.toFixed(2),fixed:groups.fixed.toFixed(2),intangible:groups.intangible.toFixed(2),other:groups.other.toFixed(2),
  value:Object.values(groups).reduce((s,v)=>s.add(v),new Decimal(0)).toFixed(2),otherCount,excludedCount,marketFallbackCount,
  allocation:['current','fixed','intangible','other'].map(name=>({name,value:groups[name as keyof typeof groups].toNumber()}))};
}
