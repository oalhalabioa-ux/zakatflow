import {expect,it} from 'vitest';
import {zakatPaymentFx as quote} from './zakat-payment-fx';
import {zakatPaymentPreview} from './zakat-payment-preview';
const rate={id:'r',organization_id:'org',from_currency:'USD',to_currency:'SAR',rate:3.75,valuation_date:'2026-10-01',source:'Manual'};
it('converts dollars using the selected saved quote',()=>expect(quote(100,'USD','SAR',[rate],'r','2026-10-19')).toMatchObject({rate:3.75,baseAmount:375}));
it('supports an inverse registered quote',()=>expect(quote(100,'USD','SAR',[{...rate,from_currency:'SAR',to_currency:'USD',rate:.25}],'r','2026-10-19')?.baseAmount).toBe(400));
it('never substitutes a reference peg when a quote is missing or future-dated',()=>{expect(quote(100,'USD','SAR',[],null,'2026-10-19')).toBeNull();expect(quote(100,'USD','SAR',[rate],'r','2026-09-01')).toBeNull()});
it('uses one for a base-currency payment',()=>expect(quote(100,'SAR','SAR',[],null,'2026-10-19')?.baseAmount).toBe(100));
it('separates native dollar debit from base-currency liability settlement',()=>expect(zakatPaymentPreview({amount:375,cashAmount:100,finalRemaining:350,carriedCredit:0,accountBalance:1000})).toMatchObject({debit:100,after:900,remaining:0,carried:25}));
