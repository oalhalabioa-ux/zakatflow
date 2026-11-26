import {expect,it,vi} from 'vitest';
import {foreignCompanyFixture} from '../app/design-preview/financial-reports/group-acceptance/scenario';
import {reviewApprovedGroupTranslation,type GroupTranslationRateRequest} from '../lib/financial-group-approved-translation';
import {normalizeStatementSource} from '../lib/financial-statement-source';

const quoteId='19000000-0000-4000-8000-000000000001';
const policyId='19000000-0000-4000-8000-000000000002';
const rateByPurpose={PRIOR_CLOSING:'3.70',TRANSACTION:'3.75',CLOSING:'3.80'};
const quote=(q:GroupTranslationRateRequest)=>({
 asOf:q.asOf,quoteId,quoteDate:q.asOf,quoteFrom:q.fromCurrency,quoteTo:q.toCurrency,rate:rateByPurpose[q.purpose],
 policy:{id:policyId,organization_id:q.organization,from_currency:q.fromCurrency,to_currency:q.toCurrency,purpose:q.purpose,
  period_start:'2024-01-01',period_end:'2027-12-31',source:'Approved test publication',selection_basis:'EXACT_DATE',
  allow_inverse:false,approved_by:'19000000-0000-4000-8000-000000000003'},
});
function testInput(){
 const {foreign,control}=foreignCompanyFixture();
 foreign.events[0].date=foreign.to;
 const snapshot=normalizeStatementSource(foreign,{organization:foreign.organizationId,from:foreign.from,to:foreign.to},true);
 return {foreign,snapshot,group:control.rootOrganizationId};
}

it('uses approved closing and transaction rates independently on the same date',async()=>{
 const {foreign,snapshot,group}=testInput();
 const resolve=vi.fn(async q=>quote(q));
 const translated=await reviewApprovedGroupTranslation(foreign,snapshot,group,'SAR',resolve);
 expect(translated.netProfit).toBe('-187.5000');
 expect(translated.position.assets).toBe('1710.0000');
 expect(translated.cash).toMatchObject({closing:'1710.0000',operating:'-187.5000',exchangeRateEffect:'47.5000'});
 expect(resolve.mock.calls.map(([q])=>[q.asOf,q.purpose])).toEqual([
  [foreign.openingDate,'PRIOR_CLOSING'],[foreign.to,'TRANSACTION'],[foreign.to,'CLOSING'],
 ]);
 expect(translated.approvedQuotes).toHaveLength(3);
 expect(translated.approvedQuotes.every(row=>row.policyId===policyId&&row.quoteId===quoteId)).toBe(true);
});

it('does not use another purpose, an unapproved organization, or a future quote',async()=>{
 const {foreign,snapshot,group}=testInput();
 const translate=(resolver:(q:GroupTranslationRateRequest)=>Promise<unknown>)=>
  reviewApprovedGroupTranslation(foreign,snapshot,group,'SAR',resolver);
 await expect(translate(async q=>{
  if(q.purpose==='TRANSACTION')throw Error('REPORTING_FX_POLICY_MISSING');
  return quote(q);
 })).rejects.toThrow('REPORTING_FX_POLICY_MISSING');
 await expect(translate(async q=>{
  const invalid=quote(q);invalid.policy.organization_id=foreign.organizationId;return invalid;
 })).rejects.toThrow('GROUP_FX_POLICY_SOURCE_INVALID');
 await expect(translate(async q=>({...quote(q),quoteDate:'2027-01-01'}))).rejects.toThrow('GROUP_FX_POLICY_SOURCE_INVALID');
});
