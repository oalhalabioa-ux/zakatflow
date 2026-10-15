import {expect,it} from 'vitest';
import {organizationAssetDashboard} from './organization-assets-dashboard';
import type {RegisterData} from './financial-register';
const data=(extra:Partial<RegisterData>)=>({baseCurrency:'SAR',accounts:[],debts:[],assets:[],...extra}) as RegisterData;
const asset=(type:string,cost:number,market:number,category='ASSET',currency='SAR')=>({type,cost,market,category,currency}) as RegisterData['assets'][number];
it('groups corporate assets and uses operational balances instead of legacy duplicates',()=>{
 const [s]=organizationAssetDashboard(data({accounts:[{baseCurrency:'SAR',baseBalance:100} as any],debts:[{currency:'SAR',side:'RECEIVABLE',amount:20},{currency:'SAR',side:'SUPPLIER_ADVANCE',amount:5},{currency:'SAR',side:'PAYABLE',amount:999}] as any,assets:[asset('BUILDING',200,250),asset('SOFTWARE',30,30),asset('INVENTORY',40,45),asset('BOND',50,55,'INVESTMENT'),asset('BANK',100,100,'LEGACY_CASH')]}));
 expect(s.current).toBe(165);expect(s.fixed).toBe(200);expect(s.intangible).toBe(30);expect(s.other).toBe(50);expect(s.totalCost).toBe(445);expect(s.totalMarket).toBe(505);expect(s.difference).toBe(60);expect(s.count).toBe(4);expect(s.legacyCount).toBe(1);
});
it('never combines values in different currencies',()=>{const rows=organizationAssetDashboard(data({assets:[asset('LAND',10,12,'ASSET','SAR'),asset('LAND',20,23,'ASSET','USD')]}));expect(rows.map(s=>[s.currency,s.totalCost])).toEqual([['SAR',10],['USD',20]]);});
it('keeps uncategorized assets under other and empty verified data at zero',()=>{expect(organizationAssetDashboard(data({assets:[asset('UNKNOWN',7,8)]}))[0].other).toBe(7);expect(organizationAssetDashboard(data({}))[0].totalCost).toBe(0);});
