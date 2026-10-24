import Decimal from 'decimal.js';
import {organizationAssetCategory} from './organization-assets-dashboard';
import type {RegisterAsset} from './financial-register';
import type {organizationAssetDashboard} from './organization-assets-dashboard';
export type CorporateAssetSummary=ReturnType<typeof organizationAssetDashboard>[number];
export const corporateAssetCategories=['current','fixed','intangible','investment','other'] as const;
export type CorporateAssetCategory=typeof corporateAssetCategories[number];
export function corporateAssetCategory(asset:RegisterAsset):CorporateAssetCategory {
 return organizationAssetCategory(asset);
}
/** Present the existing currency summary; operational balances enter only the current category. */
export function corporateAssetPresentation(summary:CorporateAssetSummary){
 const categories=corporateAssetCategories.map(key=>({key,cost:summary[key],market:summary.assets.filter(a=>corporateAssetCategory(a)===key).reduce((n,a)=>n.plus(a.market),new Decimal(key==='current'?summary.cash:0)).plus(key==='current'?summary.receivables:0).toNumber()}));
 const proportional=summary.totalCost>0&&categories.every(c=>c.cost>=0);
 let cursor=0;
 return {categories:categories.map(c=>{const share=proportional?c.cost/summary.totalCost*100:null;const start=cursor;cursor+=share??0;return {...c,share,start,end:cursor}}),proportional,
  currentRegister:new Decimal(summary.current).minus(summary.cash).minus(summary.receivables).toNumber(),
  comparisonMax:Math.max(1,...categories.flatMap(c=>[c.cost,c.market]))};
}
