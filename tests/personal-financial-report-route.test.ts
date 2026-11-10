import {beforeEach,describe,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({authenticated:true,calls:[] as unknown[][]}));
vi.mock('../services/financial-register',()=>({financialRegister:async(...args:unknown[])=>{
 state.calls.push(args);if(!state.authenticated)throw Error('UNAUTHORIZED');
 return{asOf:'2026-11-06',baseCurrency:'SAR',organizations:[],organizationIds:[],entities:[],accounts:[],cashMovements:[],debts:[],debtMovements:[],assets:[],warnings:[]};
}}));
vi.mock('../lib/financial-register',async importOriginal=>{const actual=await importOriginal<typeof import('../lib/financial-register')>();return{...actual,riyadhToday:()=> '2026-11-06'};});
import {GET} from '../app/api/financial-reporting/personal/route';
const url=(q='')=>'http://localhost/api/financial-reporting/personal'+q;
beforeEach(()=>{state.calls=[];state.authenticated=true});
describe('personal financial reporting access and query validation',()=>{
 it('uses only the signed-in personal source and never accepts a company or group parameter',async()=>{
  const response=await GET(new Request(url('?from=2026-01-01&to=2026-11-06')));
  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  expect(state.calls).toEqual([['PERSONAL',null,false]]);
  expect(await response.json()).toMatchObject({scope:'PERSONAL',positions:[],cashAccounts:[]});
  for(const invalid of ['?organization=abc','?group=1','?scope=ORGANIZATION','?from=2026-01-01&from=2026-02-01']){
   expect((await GET(new Request(url(invalid)))).status).toBe(400);
  }
  expect(state.calls).toHaveLength(1);
 });
 it('denies unauthenticated users and invalid or future dates',async()=>{
  state.authenticated=false;
  expect((await GET(new Request(url()))).status).toBe(401);
  state.authenticated=true;
  for(const invalid of ['?from=2026-11-07','?from=2026-02-31','?from=2026-11-06&to=2026-01-01']){
   expect((await GET(new Request(url(invalid)))).status).toBe(400);
  }
 });
});
