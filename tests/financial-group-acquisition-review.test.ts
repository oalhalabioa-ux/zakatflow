import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {sourceBoundGroupFixture} from './financial-reporting/group-source-bound-fixture';
import {normalizeStatementSource} from '../lib/financial-statement-source';
import {reviewControlledGroupSources} from '../lib/financial-group-source-review';
const state=vi.hoisted(()=>({context:vi.fn()}));
vi.mock('../services/financial-group-registered-source',()=>({liveRegisteredGroupReviewContext:(q:unknown)=>state.context(q)}));
import {reviewGroupAcquisition} from '../services/financial-group-acquisition-review';
function fixture(){
 const {control,sources}=sourceBoundGroupFixture();control.relationships[0].directEconomicInterestPercent='80';
 const query={organization:control.rootOrganizationId,from:control.from,to:control.to};
 const context={control,preflight:reviewControlledGroupSources(control,sources.map(s=>normalizeStatementSource(s,{...query,organization:s.organizationId})))};
 const measurement={parentOrganizationId:query.organization,subsidiaryOrganizationId:control.relationships[0].subsidiaryOrganizationId,currency:'SAR',acquisitionDate:control.relationships[0].effectiveFrom,transactionType:'SINGLE_STEP_BUSINESS_COMBINATION',commonControl:false,instruments:'ORDINARY_PROPORTIONATE',consideration:'1000',considerationEvidence:'Unverified acquisition document',identifiableItems:[{id:'assets',kind:'ASSET',recognizedAmount:'1500',measurementEvidence:'Unverified asset valuation'},{id:'liabilities',kind:'LIABILITY',recognizedAmount:'500',measurementEvidence:'Unverified liability valuation'}],nci:{method:'PROPORTIONATE_NET_ASSETS'}};
 return{context,input:{query,measurement}};
}
beforeEach(()=>{vi.resetAllMocks();vi.stubEnv('FINANCIAL_GROUP_ELIMINATION_PREVIEW','true')});afterEach(()=>vi.unstubAllEnvs());
it('uses authorized live control and currency twice but never certifies user valuations',async()=>{
 const f=fixture();state.context.mockResolvedValue(f.context);const r=await reviewGroupAcquisition(f.input);
 expect(state.context).toHaveBeenCalledTimes(2);expect(state.context).toHaveBeenNthCalledWith(1,f.input.query);
 expect(r).toMatchObject({status:'UNAPPROVED_ACQUISITION_REVIEW',consolidated:false,issuanceReady:false,evidenceVerified:false,persisted:false,calculation:{goodwill:'200.0000',nciAtAcquisition:'200.0000'}});
 expect(r).not.toHaveProperty('rawSources');expect(r).not.toHaveProperty('approval');
});
it('rejects forged controls, currency and approval inputs before loading sources',async()=>{
 const f=fixture();for(const extra of [{control:f.context.control},{currency:'SAR'},{approved:true}])await expect(reviewGroupAcquisition({...f.input,...extra})).rejects.toThrow();
 expect(state.context).not.toHaveBeenCalled();
});
it('rejects mismatched root, unauthorized subsidiaries and currencies',async()=>{
 const f=fixture();state.context.mockResolvedValue(f.context);
 await expect(reviewGroupAcquisition({...f.input,measurement:{...f.input.measurement,parentOrganizationId:f.input.measurement.subsidiaryOrganizationId}})).rejects.toThrow('GROUP_ACQUISITION_SCOPE_MISMATCH');
 expect(state.context).not.toHaveBeenCalled();
 await expect(reviewGroupAcquisition({...f.input,measurement:{...f.input.measurement,currency:'USD'}})).rejects.toThrow('GROUP_ACQUISITION_FX_REQUIRED');
 await expect(reviewGroupAcquisition({...f.input,measurement:{...f.input.measurement,subsidiaryOrganizationId:'90000000-0000-4000-8000-000000000009'}})).rejects.toThrow('GROUP_ACQUISITION_CONTROL_REQUIRED');
});
it('fails if permission is revoked on final reread',async()=>{
 const f=fixture();state.context.mockResolvedValueOnce(f.context).mockRejectedValueOnce(Error('REPORTING_ACCESS_DENIED'));
 await expect(reviewGroupAcquisition(f.input)).rejects.toThrow('REPORTING_ACCESS_DENIED');
});
it('fails if registry or source amounts change during calculation',async()=>{
 for(const kind of ['registry','source']){
  const f=fixture(),after=structuredClone(f.context);
  if(kind==='registry')after.control.registry.revision='b'.repeat(32);else after.preflight.wholeEntityRollup.totalDebit='9999.0000';
  state.context.mockResolvedValueOnce(f.context).mockResolvedValueOnce(after);
  await expect(reviewGroupAcquisition(f.input)).rejects.toThrow('REPORTING_SOURCE_CHANGED_DURING_VERIFICATION');
 }
});
it('is disabled before any access and rejects a mismatched internal scope',async()=>{
 const f=fixture();vi.stubEnv('FINANCIAL_GROUP_ELIMINATION_PREVIEW','false');await expect(reviewGroupAcquisition(f.input)).rejects.toThrow('REPORTING_DISABLED');expect(state.context).not.toHaveBeenCalled();
 vi.stubEnv('FINANCIAL_GROUP_ELIMINATION_PREVIEW','true');f.context.control.to='2027-12-31';state.context.mockResolvedValue(f.context);
 await expect(reviewGroupAcquisition(f.input)).rejects.toThrow('GROUP_ACQUISITION_SCOPE_MISMATCH');
});
