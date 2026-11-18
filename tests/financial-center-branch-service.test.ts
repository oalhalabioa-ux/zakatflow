import {beforeEach,expect,it,vi} from 'vitest';
const org='10000000-0000-4000-8000-000000000001',center='20000000-0000-4000-8000-000000000002',branch='30000000-0000-4000-8000-000000000003',actor='40000000-0000-4000-8000-000000000004';
const state=vi.hoisted(()=>({authenticated:true,enabled:true,error:null as string|null,data:null as unknown,calls:[] as {name:string;args:unknown}[]}));
vi.mock('../services/auth',()=>({requireUser:async()=>{if(!state.authenticated)throw Error('UNAUTHORIZED');return{supabase:{rpc:async(name:string,args:unknown)=>{state.calls.push({name,args});return{data:state.data,error:state.error?{message:state.error}:null}}}}}}));
vi.mock('../services/financial-statement-live',()=>({assertLiveStatements:()=>{if(!state.enabled)throw Error('DISABLED')}}));
import {centerBranchRegistry,centerBranchesForPeriod,assignCenterBranch,transferCenterBranch} from '../services/financial-center-branch-registry';
const good={organization:org,center,branch,from:'2026-01-01',to:null,expectedRevision:0,reason:'Assignment'};
beforeEach(()=>Object.assign(state,{authenticated:true,enabled:true,error:null,calls:[],data:{organizationId:org,complete:true,revision:'1',branches:[branch],centerIds:[center],assignments:[{id:center,organizationId:org,centerId:center,branchId:branch,from:'2026-01-01',to:null,status:'APPROVED',approvedBy:actor,revision:'1'}]}}));
it('reads authorized complete registry and checks effective date coverage for reports',async()=>{
 const r=await centerBranchesForPeriod({organization:org,from:'2026-01-01',to:'2026-12-31'});expect(r.centers).toEqual([{id:center,branchId:branch}]);
 expect(state.calls[0]).toEqual({name:'financial_center_branch_registry',args:{p_org:org}});
 await expect(centerBranchesForPeriod({organization:org,from:'2025-01-01',to:'2025-12-31'})).rejects.toThrow('CENTER_BRANCH_ASSIGNMENT_MISSING');
});
it('never accepts foreign or incomplete registry claims',async()=>{
 (state.data as any).complete=false;await expect(centerBranchRegistry({organization:org})).rejects.toThrow('CENTER_BRANCH_REGISTRY_INVALID');
 (state.data as any).complete=true;(state.data as any).organizationId=actor;await expect(centerBranchRegistry({organization:org})).rejects.toThrow('CENTER_BRANCH_REGISTRY_INVALID');
});
it('writes validated dated assignments with expected revision through the current user RPC',async()=>{
 state.data={id:center,revision:1,status:'APPROVED'};await assignCenterBranch(good);
 expect(state.calls).toEqual([{name:'assign_financial_center_branch',args:{p_org:org,p_center:center,p_branch:branch,p_from:'2026-01-01',p_to:null,p_expected_revision:0,p_reason:'Assignment'}}]);
});
it('rejects invalid dates, unknown fields and malformed revision before database calls',async()=>{
 for(const input of [{...good,from:'2026-02-30'},{...good,to:'2025-12-31'},{...good,complete:true},{...good,expectedRevision:-1}])await expect(assignCenterBranch(input)).rejects.toThrow();
 expect(state.calls).toHaveLength(0);
});
it('denies anonymous use and redacts database errors',async()=>{
 state.authenticated=false;await expect(assignCenterBranch(good)).rejects.toThrow('UNAUTHORIZED');
 state.authenticated=true;state.error='private SQL error';await expect(assignCenterBranch(good)).rejects.toThrow('CENTER_BRANCH_UNAVAILABLE');
 state.error='CENTER_BRANCH_VERSION_CONFLICT query detail';await expect(assignCenterBranch(good)).rejects.toThrow('CENTER_BRANCH_VERSION_CONFLICT');
});

it('transfers through the atomic audited RPC without rewriting historical assignments in the client',async()=>{
 state.data={id:center,revision:2,status:'APPROVED'};
 await transferCenterBranch({action:'transfer',organization:org,center,branch:null,from:'2027-01-01',expectedRevision:1,reason:'Move to HQ'});
 expect(state.calls).toEqual([{name:'transfer_financial_center_branch',args:{p_org:org,p_center:center,p_branch:null,p_from:'2027-01-01',p_expected_revision:1,p_reason:'Move to HQ'}}]);
 state.error='CENTER_BRANCH_FUTURE_TRANSFER_REQUIRED';await expect(transferCenterBranch({action:'transfer',organization:org,center,branch:null,from:'2020-01-01',expectedRevision:1,reason:'Past'})).rejects.toThrow('CENTER_BRANCH_FUTURE_TRANSFER_REQUIRED');
});
