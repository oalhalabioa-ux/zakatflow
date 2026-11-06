import {beforeEach,describe,expect,it,vi} from 'vitest';
const org='10000000-0000-4000-8000-000000000001';
const opening='20000000-0000-4000-8000-000000000002';
const id='30000000-0000-4000-8000-000000000003';
const state=vi.hoisted(()=>({authenticated:true,enabled:true,error:null as string|null,queries:[] as {name:string;args:any}[]}));
vi.mock('../services/auth',()=>({requireUser:async()=>{if(!state.authenticated)throw Error('UNAUTHORIZED');return{
 supabase:{rpc:async(name:string,args:any)=>{state.queries.push({name,args});return{
  data:{status:'DRAFT',id:'demo'},error:state.error?{message:state.error}:null,
 }}},user:{id:'owner'},
}}}));
vi.mock('../services/financial-opening-workspace',()=>({assertOpeningWorkspace:()=>{if(!state.enabled)throw Error('OPENING_DISABLED')}}));
import {branchOpeningContext,branchOpeningCommand} from '../services/financial-branch-opening-workspace';
import {GET,POST} from '../app/api/financial-reporting/branch-openings/route';
beforeEach(()=>Object.assign(state,{authenticated:true,enabled:true,error:null,queries:[]}));
const good={action:'save' as const,organization:org,fiscalStart:'2026-01-01',expectedVersion:0,
 openingWorkspace:opening,openingVersion:2,reason:'Attribution evidence',
 entries:{bank:[{branchId:null,debit:'100.0000',credit:'0.0000'}]}};
describe('authenticated opening distribution adapter',()=>{
 it('passes only validated opening data to scoped RLS financial RPCs',async()=>{
  const result=await branchOpeningCommand(good);
  expect(result).toMatchObject({status:'DRAFT'});
  expect(state.queries).toEqual([{name:'save_financial_branch_opening',args:{
   p_org:org,p_fiscal_start:'2026-01-01',p_expected_version:0,
   p_opening_workspace:opening,p_opening_version:2,
   p_entries:good.entries,p_reason:'Attribution evidence',
  }}]);
 });
 it('validates journal-independent opening dimensions and approval request',async()=>{
  await expect(branchOpeningCommand({...good,entries:{bank:[{branchId:'wrong',debit:'0',credit:'0'}]}})).rejects.toThrow();
  await expect(branchOpeningCommand({...good,extra:'unrecognized'})).rejects.toThrow();
  await branchOpeningCommand({action:'approve',id,expectedVersion:3});
  expect(state.queries).toEqual([{name:'approve_financial_branch_opening',args:{p_distribution:id,p_expected_version:3}}]);
 });
 it('read calls scoped context and denies anonymous or disabled access',async()=>{
  await branchOpeningContext({organization:org,fiscalStart:'2026-01-01'});
  expect(state.queries[0]).toMatchObject({name:'financial_branch_opening_context',args:{p_org:org}});
  state.authenticated=false;
  await expect(branchOpeningContext({organization:org,fiscalStart:'2026-01-01'})).rejects.toThrow('UNAUTHORIZED');
  state.enabled=false;await expect(branchOpeningCommand(good)).rejects.toThrow('OPENING_DISABLED');
 });
 it('redacts database errors while preserving safe known codes',async()=>{
  state.error='BRANCH_OPENING_SOURCE_CHANGED some internal query';
  await expect(branchOpeningCommand(good)).rejects.toThrow('BRANCH_OPENING_SOURCE_CHANGED');
  state.error='Postgres private SQL secrets';
  await expect(branchOpeningCommand(good)).rejects.toThrow('BRANCH_OPENING_UNAVAILABLE');
 });
 it('GET rejects duplicate/ambiguous scope and returns non-cacheable context',async()=>{
  let response=await GET(new Request('https://app.yaqeenbiz.com/api/financial-reporting/branch-openings?organization='+org+'&fiscalStart=2026-01-01'));
  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  expect((await response.json()).status).toBe('DRAFT');
  response=await GET(new Request('https://app.yaqeenbiz.com/api/financial-reporting/branch-openings?organization='+org+'&organization='+org+'&fiscalStart=2026-01-01'));
  expect(response.status).toBe(422);
 });
 it('POST rejects cross-origin requests before calling any RPC',async()=>{
  const base='https://app.yaqeenbiz.com/api/financial-reporting/branch-openings';
  const request=(origin:string,body:any)=>new Request(base,{method:'POST',headers:{origin,
   'content-type':'application/json','sec-fetch-site':'same-origin'},body:JSON.stringify(body)});
  const bad=await POST(request('https://evil.example',good));
  expect(bad.status).toBe(403);expect(state.queries).toHaveLength(0);
  const goodResponse=await POST(request('https://app.yaqeenbiz.com',good));
  expect(goodResponse.status).toBe(200);expect(state.queries).toHaveLength(1);
 });
});
