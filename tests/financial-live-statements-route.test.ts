import {beforeEach,describe,it,expect,vi} from 'vitest';
const state=vi.hoisted(()=>({error:'REPORTING_SOURCE_PROVENANCE_INVALID'}));
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
beforeEach(()=>{state.error='REPORTING_SOURCE_PROVENANCE_INVALID'});
describe('Production statement route error classification',()=>{
 it('treats malformed source and incomplete original-line evidence as internal integrity failures',async()=>{
  for(const code of ['REPORTING_SOURCE_PROVENANCE_INVALID','REPORTING_SOURCE_LINEAGE_INCOMPLETE']){
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
