import {describe,expect,it} from 'vitest';
import {foreignCompanyFixture,groupAcceptanceScenario} from '../app/design-preview/financial-reports/group-acceptance/scenario';
import {reviewGroupCurrencyTranslation} from '../lib/financial-group-translation-review';

describe('foreign operation review from canonical V2 journals',()=>{
 it('uses separate opening, transaction and closing rates and reconciles equity and cash',()=>{
  const {foreign,basis}=foreignCompanyFixture();
  const original=structuredClone(foreign);
  const result=reviewGroupCurrencyTranslation(foreign,basis);
  expect(result.netProfit).toBe('-187.5000');
  expect(result.position).toMatchObject({openingEquity:'1850.0000',closingEquity:'1710.0000',translationDifference:'47.5000'});
  expect(result.cash).toMatchObject({opening:'1850.0000',operating:'-187.5000',exchangeRateEffect:'47.5000',closing:'1710.0000'});
  expect(result.sourceJournalIds).toEqual([foreign.events[0].id]);
  expect(foreign).toEqual(original);
 });
 it('rejects missing or duplicate rates and a mismatched functional currency',()=>{
  const {foreign,basis}=foreignCompanyFixture();
  expect(()=>reviewGroupCurrencyTranslation(foreign,{...basis,rates:[basis.rates[0],basis.rates[2]]})).toThrow('GROUP_FX_DATED_RATE_REQUIRED');
  expect(()=>reviewGroupCurrencyTranslation(foreign,{...basis,rates:[...basis.rates,basis.rates[1]]})).toThrow('GROUP_FX_RATE_INVALID');
  expect(()=>reviewGroupCurrencyTranslation(foreign,{...basis,rates:[{...basis.rates[0],rate:'0'},...basis.rates.slice(1)]})).toThrow('GROUP_FX_RATE_INVALID');
  expect(()=>reviewGroupCurrencyTranslation(foreign,{...basis,functionalCurrency:'EUR'})).toThrow('GROUP_FX_CURRENCY_MISMATCH');
 });
 it('rejects in-period equity movements until they can be translated separately',()=>{
  const {foreign,basis}=foreignCompanyFixture();
  foreign.policy.rules[0].debitAccountId=foreign.accounts.find(a=>a.kind==='EQUITY')!.id;
  expect(()=>reviewGroupCurrencyTranslation(foreign,basis)).toThrow('GROUP_FX_EQUITY_MOVEMENT_UNSUPPORTED');
 });
 it('reuses approved matches for eliminations, closed currency gates and 80/20 attribution',()=>{
  const r=groupAcceptanceScenario();
  const amount=(rows:{key:string;adjustment:string}[],key:string)=>rows.find(x=>x.key===key)?.adjustment;
  expect(r.position.find(x=>x.key==='assets')?.before).toBe('1050.0000');
  expect(amount(r.position,'assets')).toBe('-50.0000');
  expect(amount(r.position,'liabilities')).toBe('-50.0000');
  expect(amount(r.income,'revenue')).toBe('-50.0000');
  expect(amount(r.income,'netProfit')).toBe('0.0000');
  expect(amount(r.cash,'financing')).toBe('-50.0000');
  expect(amount(r.cash,'closing')).toBe('0.0000');
  expect(r.mixedCurrencyBlocked).toBe(true);
  expect(r.ownership).toBe('80.000000');
  expect(r.nci).toMatchObject({nciPercent:'20.000000',profit:{nci:'-37.5000'},nciOtherComprehensiveIncome:'9.5000',closingNci:'342.0000'});
 });
});
