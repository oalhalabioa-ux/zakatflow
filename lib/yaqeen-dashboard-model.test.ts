import {expect,it} from 'vitest';
import {yaqeenDashboardModel} from './yaqeen-dashboard-model';
it('does not infer profit, zakat or budget figures in a different currency',()=>{const m=yaqeenDashboardModel({assets:null,financial:{organization:{base_currency:'SAR'},cash:{available:50,weeks:[]},budget:{plan:{currency:'USD'},metrics:{actualRevenue:9999}},organizationAssets:null},personal:false,ar:true,locale:'ar'});expect(m.metrics[0].value).toBeNull();expect(m.metrics[2].value).toBeNull();expect(m.metrics[3].value).toBe(50);expect(m.metrics[5].value).toBeNull();expect(m.series).toEqual([])});
it('retains authorized personal asset and zakat results and leaves unavailable values unknown',()=>{const m=yaqeenDashboardModel({assets:{totalPurchaseSar:'200',totalCurrentSar:'220',gainSar:'20',remainingZakahSar:'5',openCycleEstimateSar:'2',asOfZakahBalanceSar:'7'},financial:null,personal:true,ar:true,locale:'ar'});expect(m.metrics.map(x=>x.value)).toEqual([200,220,20,5,2,7]);expect(m.demo).toBeUndefined();expect(m.liabilities).toBeNull();expect(m.invoices).toEqual([])});
it('includes classified investments in the corporate main dashboard distribution',()=>{
 const model=yaqeenDashboardModel({assets:null,financial:{organization:{base_currency:'SAR'},organizationAssets:{current:'10',fixed:'20',intangible:'30',investment:'40',other:'5',value:'105'}},personal:false,ar:true,locale:'ar'});
 expect(model.allocation.find(a=>a.label==='استثمارات')?.value).toBe(40);
 expect(model.allocation.reduce((n,a)=>n+a.value,0)).toBe(model.assets);
 expect(model.allocation.find(a=>a.label==='أخرى')?.value).toBe(5);
});
