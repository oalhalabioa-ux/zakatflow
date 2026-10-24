import {expect,it} from 'vitest';
import {organizationAssetDashboard} from './organization-assets-dashboard';
import {corporateAssetPresentation} from './corporate-asset-presentation';
import type {RegisterData} from './financial-register';
const register=(overrides:Partial<RegisterData>)=>({baseCurrency:'SAR',accounts:[],debts:[],assets:[],...overrides}) as RegisterData;
it('compares costs and saved valuations without duplicating operational cash or receivables',()=>{
 const [summary]=organizationAssetDashboard(register({accounts:[{baseCurrency:'SAR',baseBalance:100}] as any,debts:[{currency:'SAR',side:'RECEIVABLE',amount:20}] as any,assets:[{type:'INVENTORY',cost:40,market:45,currency:'SAR',category:'ASSET'},{type:'BUILDING',cost:200,market:250,currency:'SAR',category:'ASSET'},{type:'BANK',cost:100,market:100,currency:'SAR',category:'LEGACY_CASH'}] as any}));
 const view=corporateAssetPresentation(summary);
 expect(view.currentRegister).toBe(40);
 expect(view.categories.find(c=>c.key==='current')).toMatchObject({cost:160,market:165});
 expect(view.categories.reduce((n,c)=>n+c.market,0)).toBe(summary.totalMarket);
 expect(view.categories.reduce((n,c)=>n+c.cost,0)).toBe(summary.totalCost);
 expect(view.categories.at(-1)?.end).toBeCloseTo(100);
});
it('does not invent proportions for zero or negative balances',()=>{
 const [empty]=organizationAssetDashboard(register({}));expect(corporateAssetPresentation(empty).proportional).toBe(false);
 const [negative]=organizationAssetDashboard(register({accounts:[{baseCurrency:'SAR',baseBalance:-10}] as any}));
 expect(corporateAssetPresentation(negative).categories.every(c=>c.share===null)).toBe(true);
 expect(corporateAssetPresentation(negative).categories[0].market).toBe(-10);
});
it('keeps investment valuations separate from fixed assets and currency groups separate',()=>{
 const summaries=organizationAssetDashboard(register({assets:[{type:'LAND',cost:10,market:12,currency:'SAR',category:'ASSET'},{type:'LAND',cost:20,market:25,currency:'SAR',category:'INVESTMENT'},{type:'LAND',cost:30,market:35,currency:'USD',category:'ASSET'}] as any}));
 const sar=corporateAssetPresentation(summaries[0]);
 expect(sar.categories.find(c=>c.key==='fixed')?.market).toBe(12);
 expect(sar.categories.find(c=>c.key==='investment')?.market).toBe(25);
 expect(corporateAssetPresentation(summaries[1]).categories.find(c=>c.key==='fixed')?.market).toBe(35);
});
