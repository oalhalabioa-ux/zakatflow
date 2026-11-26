import {attributeGroupNonControllingInterests} from '../../../../lib/financial-group-acquisition';
import {validateGroupControlScope} from '../../../../lib/financial-group-control';
import {reviewControlledGroupSources} from '../../../../lib/financial-group-source-review';
import {groupStatementWorksheet} from '../../../../lib/financial-group-statement-worksheet';
import {reviewGroupCurrencyTranslation} from '../../../../lib/financial-group-translation-review';
import {normalizeStatementSource} from '../../../../lib/financial-statement-source';
import {sourceBoundGroupFixture} from '../../../../tests/financial-reporting/group-source-bound-fixture';

const documentId='60000000-0000-4000-8000-000000000001';
const approverId='70000000-0000-4000-8000-000000000001';

export function groupAcceptanceSources(){
 const f=sourceBoundGroupFixture();
 f.control.relationships[0].directEconomicInterestPercent='80';
 f.control.relationships[0].directVotingInterestPercent='80';
 const documents=[{
  id:documentId,status:'APPROVED',leftOrganizationId:f.entry.debitSource.organizationId,
  rightOrganizationId:f.entry.creditSource.organizationId,leftEventId:f.entry.debitSource.eventId,rightEventId:f.entry.creditSource.eventId,
  evidenceReference:'Synthetic document pair QA 392',approvedBy:approverId,approvedAt:'2026-12-31T00:00:00Z',sourceCurrent:true,
 }];
 const entry={...f.entry,documentMatchId:documentId};
 return {...f,documents,entry};
}

export function foreignCompanyFixture(){
 const f=groupAcceptanceSources();
 const foreign=f.sources[1];
 foreign.currency='USD';
 foreign.policy.currency='USD';
 for(const account of foreign.accounts)account.currency='USD';
 const event=foreign.events[0],rule=foreign.policy.rules[0];
 event.currency='USD';
 event.lines[0].baseAmount='50.0000';
 event.lines[0].cashDirection='OUTFLOW';
 rule.currency='USD';
 rule.cashDirection='OUTFLOW';
 rule.cashActivity='OPERATING';
 rule.creditAccountId='100001';
 foreign.controls={cashClosing:'450.0000'};
 const basis={
  functionalCurrency:'USD',presentationCurrency:'SAR',measurement:'NON_HYPERINFLATIONARY',
  rates:[
   {date:foreign.openingDate,rate:'3.70',reference:'Synthetic opening close'},
   {date:event.date,rate:'3.75',reference:'Synthetic transaction date'},
   {date:foreign.to,rate:'3.80',reference:'Synthetic reporting close'},
  ],
 };
 return {...f,foreign,basis};
}

export function groupAcceptanceScenario(){
 const f=groupAcceptanceSources();
 const position=groupStatementWorksheet(f.control,f.sources,[f.entry],f.documents).position;
 const income=groupStatementWorksheet(f.control,f.sources,[{
  ...f.entry,kind:'INTERCOMPANY_INCOME',debitSource:f.ref(0,'410001'),creditSource:f.ref(1,'610001'),
 }],f.documents).income;
 const cashFixture=groupAcceptanceSources();
 cashFixture.sources.forEach((source,index)=>{
  const rule=source.policy.rules[0];
  const direction=index===0?'INFLOW':'OUTFLOW';
  source.events[0].lines[0].cashDirection=direction;
  rule.cashDirection=direction;
  rule.cashActivity=index===0?'FINANCING':'INVESTING';
  if(index===0)rule.debitAccountId='100001';
  else rule.creditAccountId='100001';
  source.controls={cashClosing:index===0?'550.0000':'400.0000'};
 });
 const cash=groupStatementWorksheet(cashFixture.control,cashFixture.sources,[{
  ...cashFixture.entry,kind:'INTERCOMPANY_CASH',debitSource:cashFixture.ref(1,'100001'),creditSource:cashFixture.ref(0,'100001'),
 }],cashFixture.documents).cash;
 const {foreign,basis,sources,control}=foreignCompanyFixture();
 const translated=reviewGroupCurrencyTranslation(foreign,basis);
 const currencies=sources.map(source=>normalizeStatementSource(source,{
  organization:source.organizationId,from:source.from,to:source.to,
 }));
 let mixedCurrencyBlocked=false;
 try{reviewControlledGroupSources(control,currencies);}
 catch(error){
  if(!(error instanceof Error)||error.message!=='REPORTING_ROLLUP_CURRENCY_MISMATCH')throw error;
  mixedCurrencyBlocked=true;
 }
 const scope=validateGroupControlScope(control);
 const ownership=scope.members.find(member=>member.organizationId===foreign.organizationId)!.effectiveEconomicInterestPercent;
 const nci=attributeGroupNonControllingInterests(control,{
  parentOrganizationId:scope.rootOrganizationId,subsidiaryOrganizationId:foreign.organizationId,
  currency:translated.presentationCurrency,from:control.from,to:control.to,openingNci:'370.0000',
  adjustedProfit:translated.netProfit,oci:[{id:'currency-translation',amount:translated.position.translationDifference}],
  ordinaryDividends:'0',ownershipChanges:false,otherEquityChanges:false,goodwillImpairment:'0.0000',
  instruments:'ORDINARY_PROPORTIONATE',sourceEvidence:'Synthetic opening interest and translated ledger',
 },translated.presentationCurrency);
 return {position,income,cash,translated,mixedCurrencyBlocked,ownership,nci};
}
