vi.mock('../services/financial-group-source-review',()=>({liveGroupSourceReview:async()=>({status:'VISIBLE_COMPANIES_REVIEW_ONLY'})}));
vi.mock('../services/financial-cost-center-income',()=>({liveCostCenterIncome:async(...args:unknown[])=>{state.centerCalls.push(args);return {scope:'COST_CENTER_INCOME_ONLY'}}}));
import {beforeEach,describe,it,expect,vi} from 'vitest';
const state=vi.hoisted(()=>({error:'REPORTING_SOURCE_PROVENANCE_INVALID',centerCalls:[] as unknown[][],branchCalls:[] as unknown[][]}));
vi.mock('../services/financial-branch-report',()=>({
 liveBranchReport:async(...args:unknown[])=>{state.branchCalls.push(args);if(state.error)throw Error(state.error);return {scope:'BRANCH'}},
 liveReportBranches:async(organization:string)=>({organizationId:organization,branches:[]}),
}));
vi.mock('../services/financial-statement-live',()=>({
 liveStatementContext:async()=>[],
 liveStatementSource:async()=>{throw Error(state.error)},
}));
vi.mock('../services/financial-scope-readiness',()=>({
 liveScopeReadiness:async()=>({ready:false}),
}));
import {GET} from '../app/api/financial-reporting/live-statements/route';
const request=()=>new Request('http://localhost:3000/api/financial-reporting/live-statements?'+
 new URLSearchParams({action:'statements',organization:'10000000-0000-4000-8000-000000000001',
  from:'2026-01-01',to:'2026-12-31'}));
beforeEach(()=>{state.error='REPORTING_SOURCE_PROVENANCE_INVALID';state.branchCalls=[]});
describe('Production statement route error classification',()=>{
 it('treats malformed source and incomplete original-line evidence as internal integrity failures',async()=>{
  for(const code of ['REPORTING_SOURCE_PROVENANCE_INVALID','REPORTING_SOURCE_LINEAGE_INCOMPLETE','REPORTING_SOURCE_CHANGED_DURING_VERIFICATION']){
   state.error=code;
   const response=await GET(request());
   expect(response.status).toBe(503);
   expect((await response.json()).error).toBe(code);
   expect(response.headers.get('Cache-Control')).toContain('no-store');
  }
 });
 it('reserves HTTP 400 for user-input errors, not errors from the ledger',async()=>{
  state.error='REPORTING_INPUT_INVALID';
  expect((await GET(request())).status).toBe(400);
 });
 it('does not mask authorization or disabled-source errors as successful reports',async()=>{
  state.error='REPORTING_ACCESS_DENIED';
  expect((await GET(request())).status).toBe(403);
  state.error='UNAUTHORIZED';
  expect((await GET(request())).status).toBe(401);
  state.error='REPORTING_DISABLED';
  expect((await GET(request())).status).toBe(404);
 });
});

describe('branch route isolation',()=>{
 it('passes exact selection to branch service and never silently returns the company',async()=>{
  state.error='';const branch='20000000-0000-4000-8000-000000000002';
  const response=await GET(new Request(request().url+'&branch='+branch));
  expect(response.status).toBe(200);expect(await response.json()).toEqual({scope:'BRANCH'});
  expect(state.branchCalls[0][1]).toBe(branch);
 });
 it('rejects duplicated selectors and branch selectors on other actions',async()=>{
  for(const suffix of ['&branch=HQ&branch=ALL','&scope=BRANCH&branch=HQ'])
   expect((await GET(new Request(request().url+suffix))).status).toBe(400);
  expect((await GET(new Request('http://localhost/api?action=branches&organization=x&branch=HQ'))).status).toBe(400);
  expect(state.branchCalls).toHaveLength(0);
 });
 it('returns an explicit failure when branch attribution is incomplete',async()=>{
  state.error='REPORTING_BRANCH_OPENING_REQUIRED';
  const response=await GET(new Request(request().url+'&branch=HQ'));
  expect(response.status).toBe(503);expect(await response.json()).toEqual({error:state.error});
 });
});

describe('dimension action isolation',()=>{it('rejects conflicting selectors instead of ignoring them',async()=>{for(const action of ['group-review','cost-center-income']){const url=request().url.replace('action=statements','action='+action);expect((await GET(new Request(url))).status).toBe(200);for(const extra of [...(action==='group-review'?['&branch=HQ']:[]),'&scope=GROUP_WITH_SUBSIDIARIES','&organization=other'])expect((await GET(new Request(url+extra))).status).toBe(400);}})});

it('passes headquarters to the joint center source rather than ignoring its branch selector',async()=>{
 const url=request().url.replace('action=statements','action=cost-center-income')+'&branch=HQ';
 expect((await GET(new Request(url))).status).toBe(200);
 expect(state.centerCalls.at(-1)?.[1]).toBe('HQ');
});
