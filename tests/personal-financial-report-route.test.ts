import {beforeEach,describe,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({authenticated:true,calls:[] as unknown[][]}));
const periodRpc=vi.hoisted(()=>vi.fn());
const professionalReader=vi.hoisted(()=>vi.fn());
vi.mock('../services/auth',()=>({requireUser:async()=>({supabase:{rpc:periodRpc}})}));
vi.mock('../services/personal-professional-income',()=>({readPersonalProfessionalIncome:professionalReader}));
vi.mock('../services/personal-report-evidence',()=>({readPersonalReportEvidence:async()=>({cash:new Map(),income:[],issues:[]})}));
vi.mock('../services/reporting-source-contracts',()=>({
 readClassifiedPersonalActivity:async(from:string,to:string)=>({from,to,basis:'EXPLICIT_PERSONAL_DOCUMENTS',coverage:'CLASSIFIED_SUBSET',rows:[],totals:[]}),
 readPersonalCutoffSources:async({asOf}:{asOf:string})=>({debts:{scope:'PERSONAL',asOf,basis:'NATIVE_V2_MOVEMENTS',coverage:'PARTIAL',rows:[],excludedSources:[]}}),
}));
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
 it('reads recognized document net and tax for exactly the requested period',async()=>{
  vi.stubEnv('NEXT_PUBLIC_PERSONAL_INCOME','true');
  try{
   periodRpc.mockResolvedValue({data:{currency:'SAR',net:'10000.00',tax:'1500.00',count:1}});
   const document={documentId:'00000000-0000-4000-8000-000000000001',receivableId:'00000000-0000-4000-8000-000000000002',
    kind:'EXTERNAL_EVIDENCE',currency:'SAR',date:'2026-01-01',net:'10000.00',tax:'1500.00'};
   professionalReader.mockResolvedValue([document]);
   const result=await GET(new Request(url('?from=2026-01-01&to=2026-01-31')));
   expect(await result.json()).toMatchObject({professionalIncome:{currency:'SAR',net:'10000.00',tax:'1500.00',count:1},
    professionalIncomeDocuments:[document],classifiedActivity:{rows:[]},cutoffSources:{asOf:'2026-01-31'}});
   expect(periodRpc).toHaveBeenCalledWith('personal_income_period',{p_from:'2026-01-01',p_to:'2026-01-31'});
   professionalReader.mockResolvedValueOnce([{...document,net:'9999.99'}]);
   expect((await GET(new Request(url('?from=2026-01-01&to=2026-01-31')))).status).toBe(503);
   periodRpc.mockResolvedValue({error:Error('unavailable')});
   expect((await GET(new Request(url()))).status).toBe(503);
  }finally{vi.unstubAllEnvs()}
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
