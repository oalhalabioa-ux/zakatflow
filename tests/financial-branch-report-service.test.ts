import {beforeEach,describe,it,expect,vi} from 'vitest';
import {branchFixture} from './financial-reporting/branch-report-fixture';
import {normalizeStatementSource} from '../lib/financial-statement-source';
const state=vi.hoisted(()=>({rpc:vi.fn(),verify:vi.fn(),auth:vi.fn(),gate:vi.fn()}));
vi.mock('../services/auth',()=>({requireUser:()=>state.auth()}));
vi.mock('../services/financial-statement-live',()=>({assertLiveStatements:()=>state.gate(),liveStatementSource:(q:unknown)=>state.verify(q)}));
import {liveBranchReport} from '../services/financial-branch-report';
const payload=()=>branchFixture();
const q=()=>{const p=payload();return{organization:p.source.organizationId,from:p.source.from,to:p.source.to}};
beforeEach(()=>{
 vi.resetAllMocks();state.auth.mockResolvedValue({supabase:{rpc:state.rpc},user:{id:'viewer'}});
 state.rpc.mockResolvedValue({data:payload(),error:null});state.verify.mockResolvedValue(normalizeStatementSource(payload().source,q()));
});
describe('branch service verified source boundary',()=>{
 it('runs canonical source verification before returning a branch',async()=>{
  const result=await liveBranchReport(q(),'20000000-0000-4000-8000-000000000002');
  expect(state.verify).toHaveBeenCalledWith(q());expect(result.scope).toBe('BRANCH');
  expect(result.statements.cash.closing).toBe('185.0000');
 });
 it('rejects a source changing between the atomic read and source attestation',async()=>{
  const different=normalizeStatementSource(payload().source,q());different.policyId='different';state.verify.mockResolvedValue(different);
  await expect(liveBranchReport(q(),'HQ')).rejects.toThrow('REPORTING_SOURCE_CHANGED_DURING_VERIFICATION');
 });
 it('never bypasses revoked access or source integrity failures',async()=>{
  state.verify.mockRejectedValue(Error('REPORTING_ACCESS_DENIED'));
  await expect(liveBranchReport(q(),'HQ')).rejects.toThrow('REPORTING_ACCESS_DENIED');
  state.rpc.mockResolvedValue({data:null,error:{message:'REPORTING_BRANCH_OPENING_REQUIRED'}});
  await expect(liveBranchReport(q(),'HQ')).rejects.toThrow('REPORTING_BRANCH_OPENING_REQUIRED');
 });
 it('validates selectors before reading any financial data',async()=>{
  await expect(liveBranchReport(q(),'ALL')).rejects.toThrow();expect(state.auth).not.toHaveBeenCalled();
 });
});

describe('branch picker authorization and historical scope',()=>{
 it('includes historical inactive branches while checking membership before and after the read',async()=>{
  const {liveReportBranches}=await import('../services/financial-branch-report');const org=q().organization;
  const member=vi.fn().mockResolvedValue({data:{organization_id:org},error:null});
  const entities=vi.fn().mockResolvedValue({data:[{id:'branch',organization_id:org,name:'Historical branch',active:false}],error:null});
  const membershipChain:any={select:()=>membershipChain,eq:()=>membershipChain,maybeSingle:member};
  const entityChain:any={select:()=>entityChain,eq:()=>entityChain,limit:entities};
  state.auth.mockResolvedValue({user:{id:'viewer'},supabase:{from:(table:string)=>table==='organization_members'?membershipChain:entityChain,rpc:async()=>({data:true,error:null})}});
  expect(await liveReportBranches(org)).toEqual({organizationId:org,branches:[{id:'branch',name:'Historical branch',active:false}]});
  expect(member).toHaveBeenCalledTimes(2);
  member.mockReset().mockResolvedValueOnce({data:{organization_id:org},error:null}).mockResolvedValueOnce({data:null,error:null});
  await expect(liveReportBranches(org)).rejects.toThrow('REPORTING_ACCESS_DENIED');
 });
});
