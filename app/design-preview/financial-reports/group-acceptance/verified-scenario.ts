import {reviewCrossCurrencyTrade} from '../../../../lib/financial-group-cross-currency';
import {reviewGroupLossOfControl,reviewGroupOwnershipChange} from '../../../../lib/financial-group-ownership-change';
import {approvedGroupReportingRate,samaGroupRatePublication,type GroupRatePolicy} from '../../../../lib/financial-group-reporting-rates';
import {reviewGroupCurrencyTranslation} from '../../../../lib/financial-group-translation-review';
import {reviewTranslatedGroupCash} from '../../../../lib/financial-group-translated-cash';
import {groupAcceptanceSources} from './scenario';

const remeasurementId='82000000-0000-4000-8000-000000000001';
const policyFor=(organizationId:string,functionalCurrency:string):GroupRatePolicy=>({
 organizationId,functionalCurrency,presentationCurrency:'SAR',effectiveFrom:'2025-12-31',effectiveTo:'2026-09-30',
 publication:samaGroupRatePublication.version,status:'APPROVED',reference:'Synthetic institution authorization QA #392',
});
const classification='82000000-0000-4000-8000-000000000002:BASE';

export function crossCurrencyFixture(reverseAfterCutoff=false){
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
 if(reverseAfterCutoff){
  const adjustment=parent.events[1];
  adjustment.status='REVERSED';
  const reverseId='82000000-0000-4000-8000-000000000003';
  parent.events.push({...adjustment,id:reverseId,sourceKey:'synthetic-fx-remeasurement-reversal',
   status:'ACTUAL',date:'2026-03-31',reversesEventId:adjustment.id,
   lines:[{...adjustment.lines[0],id:reverseId+':BASE',recognitionSign:-1}]});
  parent.coverage.eventCount=3;
  parent.coverage.lineCount=3;
 }
 f.documents[0].approvedAt='2026-03-01T00:00:00Z';
 const trade={id:f.entry.id,documentMatchId:f.entry.documentMatchId,presentationCurrency:'SAR',
  debitSource:f.entry.debitSource,creditSource:{...f.entry.creditSource,remeasurementEventId:remeasurementId}};
 const policies=[policyFor(subsidiary.organizationId,'EUR')];
 const rates=[subsidiary.openingDate,date,closing].map(day=>approvedGroupReportingRate(policies,subsidiary.organizationId,'EUR','SAR',day));
 const obligation={organizationId:parent.organizationId,obligationId:'82000000-0000-4000-8000-000000000004',
  documentMatchId:trade.documentMatchId!,tradeEventId:original.id,tradeLineId:original.lines[0].id,
  accountId:trade.creditSource.accountId};
 const links=[{...obligation,adjustmentEventId:remeasurementId,cutoff:closing}];
 return {...f,trade,subsidiary,rates,links,obligations:[obligation],policies};
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

export function translatedCashFixture(){
 const f=crossCurrencyFixture();
 for(const [i,source] of f.sources.entries()){
  const inbound=i===0;
  source.events=source.events.slice(0,1);
  source.policy.rules=source.policy.rules.slice(0,1);
  source.coverage.eventCount=1;
  source.coverage.lineCount=1;
  const direction=inbound?'INFLOW':'OUTFLOW';
  source.events[0].lines[0].cashDirection=direction;
  const rule=source.policy.rules[0];
  rule.cashDirection=direction;
  rule.cashActivity=inbound?'FINANCING':'INVESTING';
  if(inbound)rule.debitAccountId='100001';
  else rule.creditAccountId='100001';
  source.controls={cashClosing:inbound?'947.0800':'400.0000'};
 }
 const request={...f.entry,kind:'INTERCOMPANY_CASH',date:'2026-01-31',amount:'447.0800',
  debitSource:f.ref(1,'100001'),creditSource:f.ref(0,'100001')};
 return {...f,request};
}

export function lossOfControlFixture(){
 const {before,after,input}=ownershipChangeFixture();
 after.relationships=[];
 after.registry={...after.registry,revision:'loss-of-control-qa',relationshipCount:0};
 after.expectedOrganizationIds=[after.rootOrganizationId];
 after.authorizedOrganizationIds=[after.rootOrganizationId];
 const disposal={subsidiaryOrganizationId:input.subsidiaryOrganizationId,currency:'SAR',effectiveDate:after.from,
  approvalId:'83000000-0000-4000-8000-000000000002',status:'APPROVED',
  sourceEvidence:'Synthetic QA #392 sale and carrying values at loss of control',
  proceeds:'900',subsidiaryCashDisposed:'80',retainedFairValue:'100',assetsIncludingGoodwill:'1400',
  liabilities:'300',carryingNci:'220',recyclableParentOci:'20',retainedEarningsTransfer:'5'};
 return {before,after,disposal};
}

export function verifiedGroupScenario(){
 const fx=crossCurrencyFixture(true),ownership=ownershipChangeFixture();
 const trade=reviewCrossCurrencyTrade(fx.control,fx.sources,fx.trade,fx.documents,fx.links,fx.obligations,fx.policies);
 const translation=reviewGroupCurrencyTranslation(fx.subsidiary,{
  functionalCurrency:'EUR',presentationCurrency:'SAR',measurement:'NON_HYPERINFLATIONARY',
  rates:fx.rates.map(({date,rate,reference})=>({date,rate,reference})),
 });
 const equity=reviewGroupOwnershipChange(ownership.before,ownership.after,ownership.input);
 const cashFixture=translatedCashFixture();
 const cash=reviewTranslatedGroupCash(cashFixture.control,cashFixture.sources,cashFixture.request,cashFixture.documents,cashFixture.policies);
 const d=lossOfControlFixture();
 const disposal=reviewGroupLossOfControl(d.before,d.after,d.disposal);
 return {trade,translation,equity,cash,disposal};
}
