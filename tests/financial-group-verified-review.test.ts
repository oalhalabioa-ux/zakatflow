import {describe,expect,it} from 'vitest';
import {crossCurrencyFixture,ownershipChangeFixture,verifiedGroupScenario}
 from '../app/design-preview/financial-reports/group-acceptance/verified-scenario';
import {reviewCrossCurrencyTrade} from '../lib/financial-group-cross-currency';
import {reviewGroupOwnershipChange} from '../lib/financial-group-ownership-change';
import {groupReportingRate} from '../lib/financial-group-reporting-rates';

describe('published group exchange rates and documentary elimination',()=>{
 it('uses SAMA rates exactly for the published pair and date',()=>{
  expect(groupReportingRate('EUR','SAR','2026-01-31')).toMatchObject({rate:'4.4708',reference:'SAMA_2026_09_TABLE_2B'});
  expect(groupReportingRate('USD','SAR','2025-12-31').rate).toBe('3.7500');
  expect(()=>groupReportingRate('EUR','SAR','2026-01-30')).toThrow('GROUP_FX_PUBLISHED_RATE_REQUIRED');
  expect(()=>groupReportingRate('EUR','USD','2026-01-31')).toThrow('GROUP_FX_PUBLISHED_RATE_REQUIRED');
  expect(()=>groupReportingRate('toString','SAR','2026-01-31')).toThrow('GROUP_FX_PUBLISHED_RATE_REQUIRED');
 });
 it('eliminates the translated trade but retains the posted fx loss and keeps the ledgers unchanged',()=>{
  const f=crossCurrencyFixture(),original=structuredClone(f.sources);
  const r=reviewCrossCurrencyTrade(f.control,f.sources,f.trade,f.documents);
  expect(r).toMatchObject({receivableEliminated:'442.9700',payableEliminated:'442.9700',
   revenueEliminated:'447.0800',expenseEliminated:'447.0800',profitBeforeElimination:'-4.1100',profitAfterElimination:'-4.1100'});
  expect(f.sources).toEqual(original);
  expect(verifiedGroupScenario().translation).toMatchObject({netProfit:'-447.0800',
   position:{translationDifference:'15.8100'},cash:{exchangeRateEffect:'11.7000'}});
 });
 it('rejects missing posted remeasurement, unequal books and revoked documentary pairing',()=>{
  const f=crossCurrencyFixture(),[parent]=f.sources;
  const review=()=>reviewCrossCurrencyTrade(f.control,f.sources,f.trade,f.documents);
  parent.events[1].lines[0].baseAmount='4.0000';
  expect(review).toThrow('GROUP_FX_CLOSING_BALANCES_UNRECONCILED');
  parent.events[1].eventType='EXPENSE';
  parent.policy.rules[1].eventType='EXPENSE';
  expect(review).toThrow('GROUP_FX_REMEASUREMENT_SOURCE_INVALID');
  f.documents[0].status='REVOKED';
  expect(review).toThrow('GROUP_ADJUSTMENT_DOCUMENT_NOT_APPROVED');
 });
});

describe('retained-control changes',()=>{
 it('splits profits at the control date and books only the ownership exchange in equity',()=>{
  const f=ownershipChangeFixture();
  const r=reviewGroupOwnershipChange(f.before,f.after,f.input);
  expect(r).toMatchObject({parentBefore:'80.000000',parentAfter:'90.000000',
   nciBefore:'250.0000',nciAfter:'125.0000',nciEquityChange:'-125.0000',parentEquityChange:'-25.0000',
   profitToNciBefore:'50.0000',profitToNciAfter:'30.0000',closingNci:'155.0000',
   considerationCashChange:'-150.0000',profitImpact:'0.0000',goodwillImpact:'0.0000'});
 });
 it('recognizes a partial sale with continued control as a receipt and parent equity gain',()=>{
  const f=ownershipChangeFixture();
  f.after.relationships[0].directEconomicInterestPercent='70';
  f.after.relationships[0].directVotingInterestPercent='70';
  expect(reviewGroupOwnershipChange(f.before,f.after,f.input)).toMatchObject({
   nciAfter:'375.0000',parentEquityChange:'25.0000',considerationCashChange:'150.0000',closingNci:'465.0000'});
 });
 it('rejects unverified control, date gaps and unmatched carrying values',()=>{
  const f=ownershipChangeFixture();
  expect(()=>reviewGroupOwnershipChange(f.before,f.after,{...f.input,carryingNetAssets:'1200'})).toThrow('GROUP_OWNERSHIP_CARRYING_BASIS_MISMATCH');
  f.after.from='2026-07-02';
  expect(()=>reviewGroupOwnershipChange(f.before,f.after,f.input)).toThrow('GROUP_OWNERSHIP_CONTINUITY_REQUIRED');
  f.after.from='2026-07-01';
  f.after.relationships[0].assessmentStatus='DRAFT';
  expect(()=>reviewGroupOwnershipChange(f.before,f.after,f.input)).toThrow('GROUP_CONTROL_EVIDENCE_UNAPPROVED');
  f.after.relationships=[];
  f.after.registry.relationshipCount=0;
  f.after.expectedOrganizationIds=[f.after.rootOrganizationId];
  f.after.authorizedOrganizationIds=[f.after.rootOrganizationId];
  expect(()=>reviewGroupOwnershipChange(f.before,f.after,f.input)).toThrow('GROUP_OWNERSHIP_CONTINUITY_REQUIRED');
 });
});
