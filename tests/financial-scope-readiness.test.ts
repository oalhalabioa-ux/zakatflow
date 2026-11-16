import {beforeEach,describe,expect,it,vi} from 'vitest';

const org='10000000-0000-4000-8000-000000000001';
const state=vi.hoisted(()=>({authenticated:true,member:true,allowed:true,revoked:false,dbError:false,groupError:null as string|null,groupEvidence:null as unknown,
 authReads:0,sourceReads:0,rpcs:[] as string[],events:[{id:'ev1',organization_id:'10000000-0000-4000-8000-000000000001',entity_id:null},{id:'ev2',organization_id:'10000000-0000-4000-8000-000000000001',entity_id:'branch-1'}],
 entities:[{id:'branch-1',organization_id:'10000000-0000-4000-8000-000000000001',entity_type:'BRANCH',active:true}],
 cashAccounts:[{id:'cash-hq',organization_id:'10000000-0000-4000-8000-000000000001',entity_id:null},{id:'cash-branch',organization_id:'10000000-0000-4000-8000-000000000001',entity_id:'branch-1'}],
 assetAccounts:[{id:'asset-hq',organization_id:'10000000-0000-4000-8000-000000000001',entity_id:null}] as Array<{id:string;organization_id:string;entity_id:string|null}>,
 openingWorkspaces:[{id:'opening-1',organization_id:'10000000-0000-4000-8000-000000000001'}]}));
const client={
 from(table:string){
  const chain={
   select(){return chain},eq(){return chain},in(){return chain},gte(){return chain},lte(){return chain},
   async maybeSingle(){state.authReads++;return{data:state.member&&!(state.revoked&&state.authReads>1)?{organization_id:org}:null,error:null}},
   async limit(){state.sourceReads++;return state.dbError?{data:null,error:{message:'SQL secret'}}:{data:table==='financial_events'?state.events:table==='organization_entities'?state.entities:table==='liquidity_accounts'?state.cashAccounts:table==='asset_accounts'?state.assetAccounts:state.openingWorkspaces,error:null}},
  };return chain;
 },
 async rpc(name:string){state.rpcs.push(name);if(name==='financial_group_control_context')return{data:state.groupEvidence,error:state.groupError?{message:state.groupError}:null};return{data:state.allowed,error:null}},
};
vi.mock('../services/auth',()=>({requireUser:async()=>{if(!state.authenticated)throw Error('UNAUTHORIZED');return{user:{id:'actor',user_metadata:{role:'platform_owner'}},supabase:client}}}));
vi.mock('../services/financial-statement-live',()=>({assertLiveStatements:()=>{},liveStatementContext:async()=>[],liveStatementSource:async()=>({})}));
import {liveScopeReadiness} from '../services/financial-scope-readiness';
import {GET} from '../app/api/financial-reporting/live-statements/route';

const period={organization:org,from:'2026-01-01',to:'2026-12-31'};
const url=(scope:string)=>'http://localhost/api/financial-reporting/live-statements?'+new URLSearchParams({action:'scope-readiness',...period,scope});
beforeEach(()=>{
 vi.stubEnv('VERCEL_ENV','preview');vi.stubEnv('FINANCIAL_SCOPE_PREFLIGHT','true');
 Object.assign(state,{authenticated:true,member:true,allowed:true,revoked:false,dbError:false,groupError:null,groupEvidence:null,authReads:0,sourceReads:0,rpcs:[],
  events:[{id:'ev1',organization_id:org,entity_id:null},{id:'ev2',organization_id:org,entity_id:'branch-1'}],entities:[{id:'branch-1',organization_id:org,entity_type:'BRANCH',active:true}],
  cashAccounts:[{id:'cash-hq',organization_id:org,entity_id:null},{id:'cash-branch',organization_id:org,entity_id:'branch-1'}],
  assetAccounts:[{id:'asset-hq',organization_id:org,entity_id:null}],openingWorkspaces:[{id:'opening-1',organization_id:org}]});
});

describe('QA-only, RLS-visible source-readiness checks',()=>{
 it('treats company-direct activity as valid and reports preflight gaps without financial figures',async()=>{
  const result=await liveScopeReadiness({...period,scope:'COMPANY_DIRECT'});
  expect(result).toMatchObject({status:'BLOCKED',scope:'COMPANY_DIRECT',organizationId:org,
   observation:{kind:'RLS_VISIBLE_ONLY',canonicalEvents:2,organizationDirectEvents:1,branchEvents:1,entityRecords:1,
    cashAccounts:{companyDirect:1,branchLinked:1,entityLinkNotVisible:0},assetAccounts:{companyDirect:1,branchLinked:0,entityLinkNotVisible:0},organizationLevelOpeningWorkspaces:1}});
  expect(result.issues).toContain('DIRECT_OPENING_ALLOCATION_UNVERIFIED');
  expect(result.issues).not.toContain('UNASSIGNED_CANONICAL_EVENTS');
  expect(JSON.stringify(result)).not.toMatch(/debit|credit|totalDebit|trialBalance|READY_FOR_BRANCH_REPORTS/);
  expect(state.authReads).toBe(2);expect(state.rpcs).toEqual(['financial_core_can','financial_core_can']);
 });
 it('reports PERSON, inactive and RLS-hidden journal dimensions without inventing headquarters totals',async()=>{
  state.entities=[
   {id:'branch-1',organization_id:org,entity_type:'BRANCH',active:true},
   {id:'person-1',organization_id:org,entity_type:'PERSON',active:true},
   {id:'disabled-branch',organization_id:org,entity_type:'BRANCH',active:false},
  ];
  state.events=[
   {id:'direct',organization_id:org,entity_id:null},
   {id:'valid-branch',organization_id:org,entity_id:'branch-1'},
   {id:'personal-operating-unit',organization_id:org,entity_id:'person-1'},
   {id:'inactive',organization_id:org,entity_id:'disabled-branch'},
   {id:'RLS-hidden',organization_id:org,entity_id:'not-visible'},
  ];
  const result=await liveScopeReadiness({...period,scope:'COMPANY_DIRECT'});
  expect(result.status).toBe('BLOCKED');
  expect(result.observation).toMatchObject({canonicalEvents:5,
   organizationDirectEvents:1,branchEvents:1,unresolvedEntityEvents:3});
  expect(result.issues).toContain('ENTITY_EVENT_LINK_UNRESOLVED');
  expect(JSON.stringify(result)).not.toMatch(/trialBalance|totalDebit|netProfit|READY_FOR_BRANCH_REPORTS/);
  expect(state.authReads).toBe(2);
 });
 it('never presents filtered RLS-visible records as complete source coverage',async()=>{
  state.events=[];state.entities=[];state.cashAccounts=[];state.assetAccounts=[];state.openingWorkspaces=[];
  const result=await liveScopeReadiness({...period,scope:'COMPANY_DIRECT'});
  expect(result.status).toBe('BLOCKED');expect(result.issues).toContain('CANONICAL_SOURCE_UNVERIFIED');
  expect(result.observation?.canonicalEvents).toBe(0);
 });
 it('reports unresolved account links as a QA observation, not an invented balance or a draft voucher',async()=>{
  state.assetAccounts=[{id:'orphan-or-invisible-branch',organization_id:org,entity_id:'not-visible'}];
  const result=await liveScopeReadiness({...period,scope:'COMPANY_DIRECT'});
  expect(result.observation?.assetAccounts).toEqual({companyDirect:0,branchLinked:0,entityLinkNotVisible:1});
  expect(result.issues).toContain('ENTITY_ACCOUNT_LINK_UNRESOLVED');
  expect(result.status).toBe('BLOCKED');
  expect(JSON.stringify(result)).not.toMatch(/debit|credit|account_id|not-visible/);
 });
 it('classifies active COMPANY-linked cash and assets as headquarters, consistently with company-linked events',async()=>{
  state.entities.push({id:'company-hq',organization_id:org,entity_type:'COMPANY',active:true});
  state.events.push({id:'ev-company',organization_id:org,entity_id:'company-hq'});
  state.cashAccounts.push({id:'cash-company',organization_id:org,entity_id:'company-hq'});
  state.assetAccounts.push({id:'asset-company',organization_id:org,entity_id:'company-hq'});
  const result=await liveScopeReadiness({...period,scope:'COMPANY_DIRECT'});
  expect(result.observation).toMatchObject({canonicalEvents:3,organizationDirectEvents:2,branchEvents:1,
   cashAccounts:{companyDirect:2,branchLinked:1,entityLinkNotVisible:0},
   assetAccounts:{companyDirect:2,branchLinked:0,entityLinkNotVisible:0}});
  expect(result.issues).not.toContain('ENTITY_ACCOUNT_LINK_UNRESOLVED');
  expect(result.status).toBe('BLOCKED');
  expect(result.observation?.kind).toBe('RLS_VISIBLE_ONLY');
 });
 it('does not infer controlled subsidiaries from the parent hierarchy or reveal member identifiers',async()=>{
  const result=await liveScopeReadiness({...period,scope:'GROUP_WITH_SUBSIDIARIES'});
  expect(result).toMatchObject({status:'BLOCKED',observation:null});
  expect(result.issues).toContain('GROUP_CONTROL_UNVERIFIED');
  expect(result.issues).toContain('GROUP_MEMBERSHIP_UNVERIFIED');
  expect(state.sourceReads).toBe(0);expect(state.authReads).toBe(2);
  expect(state.rpcs).toEqual(['financial_core_can','financial_group_control_context','financial_core_can']);
 });
 it('summarizes only approved direct evidence without revealing controlled member identifiers or financial totals',async()=>{
  state.groupEvidence={status:'EVIDENCE_ONLY',registryComplete:false,parentOrganizationId:org,asOf:'2026-12-31',
   relationships:[{subsidiaryOrganizationId:'private-child-A'},{subsidiaryOrganizationId:'private-child-B'}]};
  const result=await liveScopeReadiness({...period,scope:'GROUP_WITH_SUBSIDIARIES'});
  expect(result).toMatchObject({status:'BLOCKED',observation:null,
   groupControlEvidence:{kind:'APPROVED_CONTROL_EVIDENCE_ONLY',approvedDirectRelationships:2,registryComplete:false}});
  expect(result.issues).toContain('GROUP_ELIMINATION_UNVERIFIED');
  expect(JSON.stringify(result)).not.toMatch(/private-child|subsidiaryOrganizationId|totalDebit|READY/);
 });
 it('fails closed if the legal registry denies a hidden subsidiary or the initial authorization is revoked',async()=>{
  state.groupError='GROUP_CONTROL_READ_DENIED';
  await expect(liveScopeReadiness({...period,scope:'GROUP_WITH_SUBSIDIARIES'})).rejects.toThrow('REPORTING_ACCESS_DENIED');
  state.groupError=null;state.revoked=true;state.authReads=0;
  await expect(liveScopeReadiness({...period,scope:'GROUP_WITH_SUBSIDIARIES'})).rejects.toThrow('REPORTING_ACCESS_DENIED');
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
