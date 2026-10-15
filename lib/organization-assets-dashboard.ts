import Decimal from 'decimal.js';
import {platformAssetCategory} from './platform-asset-summary';
import type {RegisterData} from './financial-register';
/** Display-only grouping. Operational cash/debts replace legacy register duplicates. */
export function organizationAssetDashboard(data:RegisterData){
 const currencies=[...new Set([...data.accounts.map(a=>a.baseCurrency),...data.debts.filter(d=>['RECEIVABLE','SUPPLIER_ADVANCE'].includes(d.side)).map(d=>d.currency),...data.assets.filter(a=>['ASSET','INVESTMENT'].includes(a.category)).map(a=>a.currency)])];
 return (currencies.length?currencies:[data.baseCurrency]).map(currency=>{
  const assets=data.assets.filter(a=>a.currency===currency&&['ASSET','INVESTMENT'].includes(a.category));
  const sum=(values:number[])=>values.reduce((n,v)=>n.plus(v),new Decimal(0)).toNumber();
  const cash=sum(data.accounts.filter(a=>a.baseCurrency===currency).map(a=>a.baseBalance)),receivables=sum(data.debts.filter(d=>d.currency===currency&&['RECEIVABLE','SUPPLIER_ADVANCE'].includes(d.side)).map(d=>d.amount));
  const groups={current:new Decimal(cash).plus(receivables).toNumber(),fixed:0,intangible:0,other:0};
  for(const a of assets){const category=a.category==='INVESTMENT'?'other':platformAssetCategory({asset_type:a.type});groups[category]=new Decimal(groups[category]).plus(a.cost).toNumber();}
  const cost=sum(assets.map(a=>a.cost)),market=sum(assets.map(a=>a.market));
  return {currency,...groups,cash,receivables,cost,market,totalCost:new Decimal(cost).plus(cash).plus(receivables).toNumber(),totalMarket:new Decimal(market).plus(cash).plus(receivables).toNumber(),difference:new Decimal(market).minus(cost).toNumber(),count:assets.length,assets,legacyCount:data.assets.filter(a=>a.currency===currency&&a.category.startsWith('LEGACY_')).length};
 });
}
