import {reviewCrossCurrencyTrade} from '../../../../lib/financial-group-cross-currency';
import {reviewGroupOwnershipChange} from '../../../../lib/financial-group-ownership-change';
import {groupReportingRate} from '../../../../lib/financial-group-reporting-rates';
import {reviewGroupCurrencyTranslation} from '../../../../lib/financial-group-translation-review';
import {groupAcceptanceSources} from './scenario';

const remeasurementId='82000000-0000-4000-8000-000000000001';
const classification='82000000-0000-4000-8000-000000000002:BASE';

export function crossCurrencyFixture(){
 const f=groupAcceptanceSources();
 const [parent,subsidiary]=f.sources;
 const date='2026-01-31',closing='2026-02-28';
 f.control.to=closing;
 for(const source of f.sources){
  source.to=closing;
  source.events[0].date=date;
 }
 subsidiary.currency='EUR';
 subsidiary.policy.currency='EUR';
 for(const account of subsidiary.accounts)account.currency='EUR';
 for(const rule of subsidiary.policy.rules)rule.currency='EUR';
 subsidiary.events[0].currency='EUR';
 subsidiary.events[0].lines[0].baseAmount='100.0000';
 parent.events[0].lines[0].baseAmount='447.0800';

 const original=parent.events[0];
 const rule=parent.policy.rules[0];
 const financeAccountId=parent.accounts.find(account=>account.kind==='FINANCE')!.id;
 parent.events.push({...original,id:remeasurementId,sourceKey:'synthetic-fx-remeasurement',eventType:'FX_REMEASUREMENT',date:closing,
  lines:[{id:remeasurementId+':BASE',classificationId:classification,baseAmount:'4.1100',cashDirection:'NON_CASH',recognitionSign:1}]});
 parent.policy.rules.push({...rule,id:'synthetic-fx-rule',eventType:'FX_REMEASUREMENT',classificationId:classification,
  debitAccountId:financeAccountId,creditAccountId:'110001'});
 parent.coverage.eventCount=2;
 parent.coverage.lineCount=2;
 f.documents[0].approvedAt='2026-03-01T00:00:00Z';
 const trade={id:f.entry.id,documentMatchId:f.entry.documentMatchId,presentationCurrency:'SAR',
  debitSource:f.entry.debitSource,creditSource:{...f.entry.creditSource,remeasurementEventId:remeasurementId}};
 const rates=[subsidiary.openingDate,date,closing].map(day=>groupReportingRate('EUR','SAR',day));
 return {...f,trade,subsidiary,rates};
}

export function ownershipChangeFixture(){
 const {control}=groupAcceptanceSources();
 const before=structuredClone(control),after=structuredClone(control);
 before.to='2026-06-30';
 before.relationships[0].effectiveTo=before.to;
 after.from='2026-07-01';
 after.relationships=[{...after.relationships[0],
  effectiveFrom:after.from,controlAssessmentId:'83000000-0000-4000-8000-000000000001',
  directEconomicInterestPercent:'90',directVotingInterestPercent:'90'}];
 const input={subsidiaryOrganizationId:control.relationships[0].subsidiaryOrganizationId,currency:'SAR',
  method:'PROPORTIONATE_NET_ASSETS',consideration:'150',carryingNetAssets:'1250',openingNci:'200',
  beforeProfit:'250',afterProfit:'300',beforeOci:'0',afterOci:'0',sourceEvidence:'QA #392 synthetic retained-control transaction'};
 return {before,after,input};
}

export function verifiedGroupScenario(){
 const fx=crossCurrencyFixture(),ownership=ownershipChangeFixture();
 const trade=reviewCrossCurrencyTrade(fx.control,fx.sources,fx.trade,fx.documents);
 const translation=reviewGroupCurrencyTranslation(fx.subsidiary,{
  functionalCurrency:'EUR',presentationCurrency:'SAR',measurement:'NON_HYPERINFLATIONARY',
  rates:fx.rates.map(({date,rate,reference})=>({date,rate,reference})),
 });
 const equity=reviewGroupOwnershipChange(ownership.before,ownership.after,ownership.input);
 return {trade,translation,equity};
}
