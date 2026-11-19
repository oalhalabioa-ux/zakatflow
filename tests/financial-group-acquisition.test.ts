import {describe,it,expect} from 'vitest';
import {measureGroupAcquisition,attributeGroupNonControllingInterests} from '../lib/financial-group-acquisition';
import {sourceBoundGroupFixture} from './financial-reporting/group-source-bound-fixture';
function fixture(){
 const {control}=sourceBoundGroupFixture();control.relationships[0].directEconomicInterestPercent='80';
 const scope={parentOrganizationId:control.rootOrganizationId,subsidiaryOrganizationId:control.relationships[0].subsidiaryOrganizationId,currency:'SAR'};
 const acquisition={...scope,acquisitionDate:control.relationships[0].effectiveFrom,transactionType:'SINGLE_STEP_BUSINESS_COMBINATION',commonControl:false,instruments:'ORDINARY_PROPORTIONATE',consideration:'1000',considerationEvidence:'Signed acquisition consideration',identifiableItems:[{id:'assets',kind:'ASSET',recognizedAmount:'1500',measurementEvidence:'Reviewed identifiable assets'},{id:'liabilities',kind:'LIABILITY',recognizedAmount:'500',measurementEvidence:'Reviewed liabilities and tax'}],nci:{method:'PROPORTIONATE_NET_ASSETS'}};
 const attribution={...scope,from:control.from,to:control.to,openingNci:'200',adjustedProfit:'100',oci:[{id:'reserve',amount:'50'}],ordinaryDividends:'40',ownershipChanges:false,otherEquityChanges:false,goodwillImpairment:'0.0000',instruments:'ORDINARY_PROPORTIONATE',sourceEvidence:'Reviewed post-acquisition source'};
 return{control,acquisition,attribution};
}
describe('acquisition measurement boundary',()=>{
 it('measures partial goodwill using identifiable net assets and economic rather than voting interest',()=>{
  const f=fixture(),r=measureGroupAcquisition(f.control,f.acquisition,'SAR');
  expect([r.identifiableNetAssets,r.nciAtAcquisition,r.goodwill,r.bargainPurchaseCandidate]).toEqual(['1000.0000','200.0000','200.0000','0.0000']);
  expect(r.issuanceReady).toBe(false);expect(r.consolidated).toBe(false);
 });
 it('uses separately valued NCI for full goodwill rather than deriving its fair value from the purchase price',()=>{
  const f=fixture(),r=measureGroupAcquisition(f.control,{...f.acquisition,nci:{method:'FAIR_VALUE',amount:'270',valuationEvidence:'Independent NCI valuation'}},'SAR');
  expect(r.nciAtAcquisition).toBe('270.0000');expect(r.goodwill).toBe('270.0000');
 });
 it('flags a bargain purchase for reassessment and never issues or posts it',()=>{
  const f=fixture();f.acquisition.consideration='700';const r=measureGroupAcquisition(f.control,f.acquisition,'SAR');
  expect(r.goodwill).toBe('0.0000');expect(r.bargainPurchaseCandidate).toBe('100.0000');expect(r.reassessmentRequired).toBe(true);expect(r.issuanceReady).toBe(false);
 });
 it('rejects missing valuation evidence, duplicate items, date substitution and mixed currency',()=>{
  const f=fixture();
  expect(()=>measureGroupAcquisition(f.control,{...f.acquisition,nci:{method:'FAIR_VALUE',amount:'270'}},'SAR')).toThrow();
  expect(()=>measureGroupAcquisition(f.control,{...f.acquisition,identifiableItems:[...f.acquisition.identifiableItems,f.acquisition.identifiableItems[0]]},'SAR')).toThrow('GROUP_ACQUISITION_DUPLICATE_ITEM');
  expect(()=>measureGroupAcquisition(f.control,{...f.acquisition,acquisitionDate:'2026-02-01'},'SAR')).toThrow('GROUP_ACQUISITION_DATE_MISMATCH');
  expect(()=>measureGroupAcquisition(f.control,f.acquisition,'USD')).toThrow('GROUP_ACQUISITION_FX_REQUIRED');
 });
 it('rejects staged transactions, caller approval flags and non-ordinary interests',()=>{
  const f=fixture();for(const change of [{transactionType:'STAGED'},{commonControl:true},{approved:true},{instruments:'PREFERENCE_SHARES'}])expect(()=>measureGroupAcquisition(f.control,{...f.acquisition,...change},'SAR')).toThrow();
 });
 it('rejects nonzero NCI on a wholly owned subsidiary and revoked control',()=>{
  const f=fixture();f.control.relationships[0].directEconomicInterestPercent='100';
  expect(()=>measureGroupAcquisition(f.control,{...f.acquisition,nci:{method:'FAIR_VALUE',amount:'1',valuationEvidence:'Invalid NCI valuation'}},'SAR')).toThrow('GROUP_ACQUISITION_NCI_WITHOUT_MINORITY');
  f.control.relationships[0].assessmentStatus='REVOKED';expect(()=>measureGroupAcquisition(f.control,f.acquisition,'SAR')).toThrow();
 });
});
describe('constant ordinary-share NCI attribution',()=>{
 it('attributes each profit and OCI component separately and subtracts distributions',()=>{
  const f=fixture(),r=attributeGroupNonControllingInterests(f.control,f.attribution,'SAR');
  expect(r.profit).toEqual({total:'100.0000',parent:'80.0000',nci:'20.0000'});expect(r.oci[0].nci).toBe('10.0000');expect(r.dividends.nci).toBe('8.0000');expect(r.closingNci).toBe('222.0000');
 });
 it('does not cap minority losses at the opening NCI balance',()=>{
  const f=fixture();f.attribution.adjustedProfit='-2000';f.attribution.oci=[];f.attribution.ordinaryDividends='0';
  const r=attributeGroupNonControllingInterests(f.control,f.attribution,'SAR');expect(r.profit.nci).toBe('-400.0000');expect(r.closingNci).toBe('-200.0000');
 });
 it('reconciles rounded attributions exactly, including negative OCI',()=>{
  const f=fixture();f.control.relationships[0].directEconomicInterestPercent='66.666667';f.attribution.adjustedProfit='0.0001';f.attribution.oci=[{id:'reserve',amount:'-0.0001'}];
  const r=attributeGroupNonControllingInterests(f.control,f.attribution,'SAR');expect(r.profit).toEqual({total:'0.0001',parent:'0.0001',nci:'0.0000'});expect(r.oci[0].parent).toBe('-0.0001');
 });
 it('requires separate handling for ownership changes, goodwill impairment and other equity movements',()=>{
  const f=fixture();for(const change of [{ownershipChanges:true},{otherEquityChanges:true},{goodwillImpairment:'1.0000'}])expect(()=>attributeGroupNonControllingInterests(f.control,{...f.attribution,...change},'SAR')).toThrow();
 });
 it('rejects wrong periods, duplicate OCI components, unauthorized membership and a nested parent',()=>{
  const f=fixture();expect(()=>attributeGroupNonControllingInterests(f.control,{...f.attribution,from:'2026-02-01'},'SAR')).toThrow('GROUP_NCI_PERIOD_MISMATCH');
  expect(()=>attributeGroupNonControllingInterests(f.control,{...f.attribution,oci:[...f.attribution.oci,...f.attribution.oci]},'SAR')).toThrow('GROUP_NCI_DUPLICATE_OCI');
  expect(()=>attributeGroupNonControllingInterests(f.control,{...f.attribution,parentOrganizationId:f.attribution.subsidiaryOrganizationId},'SAR')).toThrow('GROUP_ACQUISITION_NESTED_OWNERSHIP_UNSUPPORTED');
  f.control.authorizedOrganizationIds=[];expect(()=>attributeGroupNonControllingInterests(f.control,f.attribution,'SAR')).toThrow();
 });
});
