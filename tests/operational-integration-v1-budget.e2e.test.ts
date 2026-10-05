import {beforeAll,describe,expect,it} from 'vitest';
import {createClient,type SupabaseClient} from '@supabase/supabase-js';

const URL=process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL||'';
const KEY=process.env.SUPABASE_PUBLISHABLE_KEY||process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY||'';
const EMAIL=process.env.E2E_OWNER_EMAIL||'';
const PASSWORD=process.env.E2E_OWNER_PASSWORD||'';
const PLAN='87f8bed8-c17a-409d-aa98-80e85bb18cfb';
const RECOGNITION='c5a33326-0719-4b63-81f4-de27257e8681';
const SETTLEMENTS=['2e79815c-0dbb-4f71-bb60-286266de75ad','92a1df4f-6ac2-430e-a710-2235e89a7e4c'];
const LINE='e939fa4e-1ad3-4f3f-bfb6-f46e7497a347';
let owner:SupabaseClient;
const n=(v:unknown)=>Number(v||0);

beforeAll(async()=>{
 if(!URL||!KEY||!EMAIL||!PASSWORD)throw new Error('E2E_BUDGET_QA_CONFIG_REQUIRED');
 owner=createClient(URL,KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 const {error}=await owner.auth.signInWithPassword({email:EMAIL,password:PASSWORD});
 if(error)throw error;
});

describe('Operational Integration V1 Budget',()=>{
 it('keeps Core Actual 100 separate from gross cash settlement 115',async()=>{
  const {data,error}=await owner.rpc('financial_budget_report',{p_plan:PLAN});
  if(error)throw error;
  const report=data as any;
  const rows=(report?.rows||[]).filter((r:any)=>r.budget_line_id===LINE);
  expect(rows.length).toBe(12);
  expect(rows.reduce((s:number,r:any)=>s+n(r.actual_amount),0)).toBe(100);
  expect(rows.reduce((s:number,r:any)=>s+n(r.paid_settled_gross),0)).toBe(115);
  expect(rows.reduce((s:number,r:any)=>s+n(r.outstanding_gross),0)).toBe(0);
  expect(report.legacy_actual_not_replaced).toBe(true);
  expect(report.forecast_not_changed).toBe(true);
  console.log('BUDGET_E2E=CORE_ACTUAL_100,PAID_115,OUTSTANDING_0');
 },30000);

 it('drilldown includes recognition and excludes settlement events from Actual',async()=>{
  const {data,error}=await owner.rpc('financial_budget_drilldown',{p_plan:PLAN});
  if(error)throw error;
  const rows=(data||[]) as any[];
  expect(rows.some(r=>r.event_id===RECOGNITION&&n(r.actual_amount)===100)).toBe(true);
  expect(rows.some(r=>SETTLEMENTS.includes(r.event_id))).toBe(false);
 },30000);

 it('does not duplicate the recognition through cash settlement',async()=>{
  const {data,error}=await owner.from('financial_budget_operational_facts').select('event_id,event_type,classification_type,actual_base_amount').eq('event_id',RECOGNITION);
  if(error)throw error;
  const opex=(data||[]).filter((r:any)=>r.classification_type==='OPEX');
  expect(opex).toHaveLength(1);
  expect(n(opex[0]?.actual_base_amount)).toBe(100);
  const {data:settlementFacts,error:settlementError}=await owner.from('financial_budget_operational_facts').select('event_id').in('event_id',SETTLEMENTS);
  if(settlementError)throw settlementError;
  expect(settlementFacts||[]).toHaveLength(0);
 },30000);
 it('consolidated report keeps settlement separate from recognition Actual',async()=>{
  const {data,error}=await owner.rpc('financial_budget_consolidated',{p_holding:'4673c66d-698d-43bb-b638-28dd556bbc27',p_year:2026,p_scenario:'BASE'});
  if(error)throw error;
  expect(data).toBeTruthy();
  const serialized=JSON.stringify(data);
  expect(serialized).toContain('100');
  expect(serialized).not.toContain('215');
  console.log('BUDGET_E2E_CONSOLIDATED=NO_215_DUPLICATION');
 },30000);

});
