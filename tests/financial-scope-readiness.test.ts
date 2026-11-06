import {beforeEach,describe,expect,it,vi} from 'vitest';

const org='10000000-0000-4000-8000-000000000001';
const state=vi.hoisted(()=>({authenticated:true,member:true,allowed:true,revoked:false,dbError:false,
 authReads:0,sourceReads:0,rpcs:[] as string[],events:[{id:'ev1',organization_id:'10000000-0000-4000-8000-000000000001',entity_id:null},{id:'ev2',organization_id:'10000000-0000-4000-8000-000000000001',entity_id:'branch-1'}],
 entities:[{id:'branch-1',organization_id:'10000000-0000-4000-8000-000000000001',entity_type:'BRANCH',active:true}]}));
const client={
 from(table:string){
  const chain={
   select(){return chain},eq(){return chain},in(){return chain},gte(){return chain},lte(){return chain},
   async maybeSingle(){state.authReads++;return{data:state.member&&!(state.revoked&&state.authReads>1)?{organization_id:org}:null,error:null}},
   async limit(){state.sourceReads++;return state.dbError?{data:null,error:{message:'SQL secret'}}:{data:table==='financial_events'?state.events:state.entities,error:null}},
  };return chain;
 },
 async rpc(name:string){state.rpcs.push(name);return{data:state.allowed,error:null}},
};
vi.mock('../services/auth',()=>({requireUser:async()=>{if(!state.authenticated)throw Error('UNAUTHORIZED');return{user:{id:'actor',user_metadata:{role:'platform_owner'}},supabase:client}}}));
vi.mock('../services/financial-statement-live',()=>({assertLiveStatements:()=>{},liveStatementContext:async()=>[],liveStatementSource:async()=>({})}));
import {liveScopeReadiness} from '../services/financial-scope-readiness';
import {GET} from '../app/api/financial-reporting/live-statements/route';

const period={organization:org,from:'2026-01-01',to:'2026-12-31'};
const url=(scope:string)=>'http://localhost/api/financial-reporting/live-statements?'+new URLSearchParams({action:'scope-readiness',...period,scope});
beforeEach(()=>{
 vi.stubEnv('VERCEL_ENV','preview');vi.stubEnv('FINANCIAL_SCOPE_PREFLIGHT','true');
 Object.assign(state,{authenticated:true,member:true,allowed:true,revoked:false,dbError:false,authReads:0,sourceReads:0,rpcs:[],
  events:[{id:'ev1',organization_id:org,entity_id:null},{id:'ev2',organization_id:org,entity_id:'branch-1'}],entities:[{id:'branch-1',organization_id:org,entity_type:'BRANCH',active:true}]});
});

describe('QA-only, RLS-visible source-readiness checks',()=>{
 it('treats company-direct activity as valid and reports preflight gaps without financial figures',async()=>{
  const result=await liveScopeReadiness({...period,scope:'COMPANY_DIRECT'});
  expect(result).toMatchObject({status:'BLOCKED',scope:'COMPANY_DIRECT',organizationId:org,
   observation:{kind:'RLS_VISIBLE_ONLY',canonicalEvents:2,organizationDirectEvents:1,branchEvents:1,entityRecords:1}});
  expect(result.issues).toContain('DIRECT_OPENING_ALLOCATION_UNVERIFIED');
  expect(result.issues).not.toContain('UNASSIGNED_CANONICAL_EVENTS');
  expect(JSON.stringify(result)).not.toMatch(/debit|credit|totalDebit|trialBalance|READY_FOR_BRANCH_REPORTS/);
  expect(state.authReads).toBe(2);expect(state.rpcs).toEqual(['financial_core_can','financial_core_can']);
 });
 it('never presents filtered RLS-visible records as complete source coverage',async()=>{
  state.events=[];state.entities=[];
  const result=await liveScopeReadiness({...period,scope:'COMPANY_DIRECT'});
  expect(result.status).toBe('BLOCKED');expect(result.issues).toContain('CANONICAL_SOURCE_UNVERIFIED');
  expect(result.observation?.canonicalEvents).toBe(0);
 });
 it('does not infer controlled subsidiaries from the parent hierarchy or reveal member identifiers',async()=>{
  const result=await liveScopeReadiness({...period,scope:'GROUP_WITH_SUBSIDIARIES'});
  expect(result).toMatchObject({status:'BLOCKED',observation:null});
  expect(result.issues).toContain('GROUP_CONTROL_UNVERIFIED');
  expect(result.issues).toContain('GROUP_MEMBERSHIP_UNVERIFIED');
  expect(state.sourceReads).toBe(0);expect(state.authReads).toBe(2);
 });
 it('rejects anonymous, missing-member and insufficient-permission requests before any metadata reads',async()=>{
  state.authenticated=false;expect((await GET(new Request(url('COMPANY_DIRECT')))).status).toBe(401);
  state.authenticated=true;state.member=false;expect((await GET(new Request(url('COMPANY_DIRECT')))).status).toBe(403);
  state.member=true;state.allowed=false;expect((await GET(new Request(url('COMPANY_DIRECT')))).status).toBe(403);
  expect(state.sourceReads).toBe(0);
 });
 it('fails closed when access disappears during the read and hides SQL errors',async()=>{
  state.revoked=true;expect((await GET(new Request(url('COMPANY_DIRECT')))).status).toBe(403);
  state.revoked=false;state.authReads=0;state.dbError=true;
  const response=await GET(new Request(url('COMPANY_DIRECT')));
  expect(response.status).toBe(503);expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  expect(await response.text()).not.toMatch(/SQL secret|entity_id|ev1/);
 });
 it('is disabled in Production, and rejects invalid, injected or ambiguous scope input',async()=>{
  vi.stubEnv('VERCEL_ENV','production');expect((await GET(new Request(url('COMPANY_DIRECT')))).status).toBe(404);
  vi.stubEnv('VERCEL_ENV','preview');vi.stubEnv('FINANCIAL_SCOPE_PREFLIGHT','false');
  expect((await GET(new Request(url('COMPANY_DIRECT')))).status).toBe(404);
  vi.stubEnv('FINANCIAL_SCOPE_PREFLIGHT','true');
  for(const value of ['STANDALONE','COMPANY_WITH_BRANCHES','GROUP_WITH_SUBSIDIARIES%26organization%3Dother']){
   expect((await GET(new Request(url(value)))).status).toBe(400);
  }
  expect((await GET(new Request(url('COMPANY_DIRECT')+'&organization='+org))).status).toBe(400);
  expect((await GET(new Request(url('COMPANY_DIRECT').replace('2026-01-01','2026-02-30')))).status).toBe(400);
 });
});
