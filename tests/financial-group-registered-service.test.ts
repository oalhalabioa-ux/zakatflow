import {beforeEach,it,expect,vi} from 'vitest';
import {branchFixture} from './financial-reporting/branch-report-fixture';
import {normalizeStatementSource} from '../lib/financial-statement-source';
const state=vi.hoisted(()=>({rpc:vi.fn(),source:vi.fn()}));
vi.mock('../services/auth',()=>({requireUser:async()=>({supabase:{rpc:state.rpc}})}));
vi.mock('../services/financial-statement-live',()=>({assertLiveStatements:()=>{},liveStatementSource:(q:unknown)=>state.source(q)}));
import {liveRegisteredGroupSource} from '../services/financial-group-registered-source';
const p=branchFixture().source,q={organization:p.organizationId,from:p.from,to:p.to},child='20000000-0000-4000-8000-000000000002';
function registry(){return{rootOrganizationId:q.organization,from:q.from,to:q.to,expectedOrganizationIds:[q.organization,child],authorizedOrganizationIds:[q.organization,child],registry:{complete:true,revision:'a'.repeat(32),relationshipCount:1},relationships:[{parentOrganizationId:q.organization,subsidiaryOrganizationId:child,effectiveFrom:q.from,effectiveTo:null,directEconomicInterestPercent:'80.000000',directVotingInterestPercent:'80.000000',controlBasis:'VOTING',controlAssessmentId:'30000000-0000-4000-8000-000000000003',assessmentStatus:'APPROVED'}]}}
beforeEach(()=>{vi.resetAllMocks();state.rpc.mockResolvedValue({data:registry(),error:null});state.source.mockImplementation(async(query:typeof q)=>{const s=normalizeStatementSource({...p,origin:'LIVE_CANONICAL_EVENTS'},q);s.statements.organizationId=query.organization;return s})});
it('reauthorizes all registered members and rechecks registry without claiming consolidation',async()=>{const r=await liveRegisteredGroupSource(q);expect(r.status).toBe('CONTROLLED_PRE_ELIMINATION_ONLY');expect(r.wholeEntityRollup.memberIds).toHaveLength(2);expect(state.source).toHaveBeenCalledTimes(4);expect(state.rpc).toHaveBeenCalledTimes(2)});
it('refuses hidden members, incomplete control and revoked child permissions',async()=>{
 state.rpc.mockResolvedValueOnce({data:null,error:{message:'GROUP_CONTROL_READ_DENIED'}});await expect(liveRegisteredGroupSource(q)).rejects.toThrow('REPORTING_ACCESS_DENIED');
 const incomplete=registry();incomplete.relationships=[];incomplete.registry.relationshipCount=0;state.rpc.mockResolvedValueOnce({data:incomplete,error:null});await expect(liveRegisteredGroupSource(q)).rejects.toThrow('GROUP_CONTROL_REGISTRY_INCOMPLETE');
 state.source.mockRejectedValueOnce(Error('REPORTING_ACCESS_DENIED'));await expect(liveRegisteredGroupSource(q)).rejects.toThrow('REPORTING_ACCESS_DENIED');
});
it('refuses registry changes during compilation',async()=>{state.rpc.mockResolvedValueOnce({data:registry(),error:null}).mockResolvedValueOnce({data:{...registry(),registry:{...registry().registry,revision:'b'.repeat(32)}},error:null});await expect(liveRegisteredGroupSource(q)).rejects.toThrow('REPORTING_SOURCE_CHANGED_DURING_VERIFICATION')});
