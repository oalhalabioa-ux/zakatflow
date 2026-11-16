import {describe,it,expect} from 'vitest';
import {bundleSelection,moduleInput,type BundleModule} from '../lib/subscriptions/bundles';
const module=(key:string,requires:string[]=[],price:number|null=.1):BundleModule=>({key,requires,name_ar:'اختبار',name_en:'Test',description_ar:'شرح الموديول',description_en:'Module details',icon:'chart',pricing:price===null?'quote':'fixed',monthly:price,yearly:price===null?null:price*12,currency:'SAR',published:true,revision:1});
describe('bundle selection and admin price validation',()=>{
 it('resolves dependencies without duplication and sums decimal currency exactly',()=>{const r=bundleSelection([module('assets'),module('liquidity'),module('budgets',['assets','liquidity'])],['budgets','assets'],'monthly');expect(r.items).toHaveLength(3);expect(r.total).toBe(.3);expect(r.unavailable).toBe(false);});
 it('never represents a mixed quoted bundle as a final numeric total',()=>expect(bundleSelection([module('assets'),module('liquidity'),module('budgets',[],null)],['budgets'],'monthly').total).toBeNull());
 it('detects unpublished dependencies and mixed currencies',()=>{const r=bundleSelection([module('assets'),{...module('liquidity'),currency:'USD'},module('budgets',['vat'])],['budgets'],'monthly');expect(r.mixedCurrency).toBe(true);expect(r.unavailable).toBe(true);});
 it('terminates even with a malformed dependency cycle',()=>expect(bundleSelection([module('assets',['liquidity']),module('liquidity',['assets'])],[],'yearly').items).toHaveLength(2));
 it('fixed mode requires real amounts while quote mode permits unset prices',()=>{const m={...module('assets',[],null),reason:'Test configuration'};expect(moduleInput.safeParse(m).success).toBe(true);expect(moduleInput.safeParse({...m,pricing:'fixed'}).success).toBe(false);expect(moduleInput.safeParse({...m,pricing:'fixed',monthly:.001,yearly:1}).success).toBe(false);});
});
