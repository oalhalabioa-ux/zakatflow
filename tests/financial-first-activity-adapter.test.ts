import {afterAll,beforeEach,describe,expect,it,vi} from 'vitest';
import fixture from './financial-reporting/statement-snapshot.json';

const state=vi.hoisted(()=>({
 mode:'first-activity' as 'first-activity'|'other-error'|'no-rpc'|'approved',
 member:true,permission:true,called:[] as string[],
}));
const org='10000000-0000-4000-8000-000000000003';
const query={organization:org,from:'2026-01-01',to:'2026-12-31'};
vi.mock('../services/financial-opening-workspace',()=>({
 assertOpeningWorkspace:()=>{},openingContext:async()=>[],
}));
vi.mock('../services/auth',()=>({requireUser:async()=>({
 user:{id:'user-1'},
 supabase:{
  rpc:async(name:string)=>{
   state.called.push(name);
   if(name==='financial_core_can')return{data:state.permission,error:null};
   if(name==='financial_statement_live_snapshot'){
    if(state.mode==='approved')return{data:{...structuredClone(fixture),origin:'LIVE_CANONICAL_EVENTS'},error:null};
    return{data:null,error:{message:state.mode==='other-error'?'REPORTING_ACCESS_DENIED':'REPORTING_APPROVED_OPENING_REQUIRED'}};
   }
   if(name==='financial_statement_first_activity_snapshot'){
    if(state.mode==='no-rpc')return{data:null,error:{message:'Could not find public RPC'}};
    const raw=structuredClone(fixture);
    raw.origin='LIVE_CANONICAL_EVENTS';
    raw.opening=[];raw.openingSourceId='FIRST_ACTIVITY:2026-01-01';
    raw.events=[];raw.policy.rules=[];
    raw.coverage.eventCount=0;raw.coverage.lineCount=0;
    return{data:raw,error:null};
   }
   throw Error('Unexpected RPC '+name);
  },
  from:()=>({
   select(){return this},eq(){return this},
   async maybeSingle(){return{data:state.member?{organization_id:org}:null,error:null}},
  }),
 },
})}));
import {liveStatementSource} from '../services/financial-statement-live';
const before=process.env.FINANCIAL_STATEMENTS_LIVE,firstBefore=process.env.FINANCIAL_FIRST_ACTIVITY_REPORTING,vercelBefore=process.env.VERCEL_ENV;
beforeEach(()=>{state.mode='first-activity';state.member=true;state.permission=true;state.called=[];process.env.FINANCIAL_STATEMENTS_LIVE='true';process.env.FINANCIAL_FIRST_ACTIVITY_REPORTING='true';delete process.env.VERCEL_ENV});
afterAll(()=>{if(before===undefined)delete process.env.FINANCIAL_STATEMENTS_LIVE;else process.env.FINANCIAL_STATEMENTS_LIVE=before;
 if(firstBefore===undefined)delete process.env.FINANCIAL_FIRST_ACTIVITY_REPORTING;else process.env.FINANCIAL_FIRST_ACTIVITY_REPORTING=firstBefore;
 if(vercelBefore===undefined)delete process.env.VERCEL_ENV;else process.env.VERCEL_ENV=vercelBefore});
describe('no-opening legal entity read adapter',()=>{
 it('requests database-attested first activity only for missing approved opening, then rechecks permissions',async()=>{
  const result=await liveStatementSource(query);
  expect(result.openingSourceId).toBe('FIRST_ACTIVITY:2026-01-01');
  expect(result.statements.cash).toMatchObject({opening:'0.0000',closing:'0.0000'});
  expect(state.called).toEqual(['financial_statement_live_snapshot','financial_statement_first_activity_snapshot','financial_core_can']);
 });
 it('does not invent zero opening when the trusted RPC is absent',async()=>{
  state.mode='no-rpc';
  await expect(liveStatementSource(query)).rejects.toThrow('REPORTING_UNAVAILABLE');
 });
 it('does not bypass source authorization or missing company membership',async()=>{
  state.mode='other-error';
  await expect(liveStatementSource(query)).rejects.toThrow('REPORTING_ACCESS_DENIED');
  expect(state.called).not.toContain('financial_statement_first_activity_snapshot');
  state.mode='first-activity';state.called=[];state.member=false;
  await expect(liveStatementSource(query)).rejects.toThrow('REPORTING_ACCESS_DENIED');
  state.member=true;state.permission=false;
  await expect(liveStatementSource(query)).rejects.toThrow('REPORTING_ACCESS_DENIED');
 });
 it('keeps the first-activity fallback disabled by default and in Production',async()=>{
  process.env.FINANCIAL_FIRST_ACTIVITY_REPORTING='false';
  await expect(liveStatementSource(query)).rejects.toThrow('REPORTING_APPROVED_OPENING_REQUIRED');
  expect(state.called).not.toContain('financial_statement_first_activity_snapshot');
  process.env.FINANCIAL_FIRST_ACTIVITY_REPORTING='true';process.env.VERCEL_ENV='production';state.called=[];
  await expect(liveStatementSource(query)).rejects.toThrow('REPORTING_APPROVED_OPENING_REQUIRED');
  expect(state.called).not.toContain('financial_statement_first_activity_snapshot');
 });
 it('preserves the existing approved opening snapshot without fallback',async()=>{
  state.mode='approved';const result=await liveStatementSource(query);
  expect(result.openingSourceId).toBe(fixture.openingSourceId);
  expect(state.called).not.toContain('financial_statement_first_activity_snapshot');
 });
});
