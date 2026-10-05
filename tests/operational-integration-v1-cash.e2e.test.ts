import { beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const URL=process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL||''
const KEY=process.env.SUPABASE_PUBLISHABLE_KEY||process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY||''
const EMAIL=process.env.E2E_OWNER_EMAIL||''
const PASSWORD=process.env.E2E_OWNER_PASSWORD||''
const ORG='85acbac0-e8b4-434c-a22b-3ec13b55e1a7'
const RECOGNITION='c5a33326-0719-4b63-81f4-de27257e8681'
const SETTLEMENT_50='2e79815c-0dbb-4f71-bb60-286266de75ad'
const SETTLEMENT_65='92a1df4f-6ac2-430e-a710-2235e89a7e4c'
const ACCOUNT='dd7cce04-d75d-4880-ac03-77f0f82d6a3a'

let owner:SupabaseClient
const n=(v:unknown)=>Number(v||0)

beforeAll(async()=>{
 if(!URL||!KEY||!EMAIL||!PASSWORD)throw new Error('E2E_CASH_QA_CONFIG_REQUIRED')
 owner=createClient(URL,KEY,{auth:{persistSession:false,autoRefreshToken:false}})
 const {error}=await owner.auth.signInWithPassword({email:EMAIL,password:PASSWORD})
 if(error)throw error
})

describe('Operational Integration V1 Cash settlement regression',()=>{
 it('preserves recognition separately from the two settlement events',async()=>{
  const {data:events,error}=await owner.from('financial_events').select('id,event_type,status,source_module').eq('organization_id',ORG).in('id',[RECOGNITION,SETTLEMENT_50,SETTLEMENT_65])
  if(error)throw error
  expect(events).toHaveLength(3)
  expect(events?.find(e=>e.id===RECOGNITION)?.event_type).not.toBe('SETTLEMENT')
  expect(events?.find(e=>e.id===RECOGNITION)?.status).toBe('ACTUAL')
  for(const id of [SETTLEMENT_50,SETTLEMENT_65]){
   expect(events?.find(e=>e.id===id)?.event_type).toBe('SETTLEMENT')
   expect(events?.find(e=>e.id===id)?.status).toBe('ACTUAL')
  }
 },30000)

 it('keeps the payable at 115 total with zero outstanding after 50 + 65',async()=>{
  const {data,error}=await owner.from('financial_event_obligation_balances').select('settleable_amount,applied_base_amount,outstanding_base_amount').eq('organization_id',ORG).eq('event_id',RECOGNITION).single()
  if(error)throw error
  expect(n(data.settleable_amount)).toBe(115)
  expect(n(data.applied_base_amount)).toBe(115)
  expect(n(data.outstanding_base_amount)).toBe(0)
 },30000)

 it('shows the linked expected flow as fully settled without converting recognition into cash',async()=>{
  const {data:links,error:linkError}=await owner.from('financial_event_links').select('target_record_id').eq('organization_id',ORG).eq('event_id',RECOGNITION).eq('link_type','CASH_FLOW').eq('target_module','liquidity_flows')
  if(linkError)throw linkError
  expect(links?.length).toBeGreaterThan(0)
  const ids=(links||[]).map(x=>x.target_record_id)
  const {data:flows,error}=await owner.from('liquidity_flows').select('id,amount,settled_amount,settlement_status,direction').eq('organization_id',ORG).in('id',ids)
  if(error)throw error
  const flow=flows?.find(f=>n(f.amount)===115)
  expect(flow).toBeTruthy()
  expect(n(flow?.settled_amount)).toBe(115)
  expect(flow?.settlement_status).toBe('SETTLED')
  expect(flow?.direction).toBe('OUTFLOW')
 },30000)

 it('requires and records independent approval before settlement posting',async()=>{
  const {data:events,error:eventError}=await owner.from('financial_events').select('id,created_by').eq('organization_id',ORG).in('id',[SETTLEMENT_50,SETTLEMENT_65])
  if(eventError)throw eventError
  const {data:approvals,error:approvalError}=await owner.from('financial_event_approvals').select('event_id,approver_id,decision').eq('organization_id',ORG).in('event_id',[SETTLEMENT_50,SETTLEMENT_65])
  if(approvalError)throw approvalError
  for(const id of [SETTLEMENT_50,SETTLEMENT_65]){
   const event=events?.find(x=>x.id===id)
   const approval=approvals?.find(x=>x.event_id===id&&x.decision==='APPROVED')
   expect(event).toBeTruthy()
   expect(approval).toBeTruthy()
   expect(approval?.approver_id).not.toBe(event?.created_by)
  }
 },30000)

 it('posts exactly two cash settlement ledger rows for 50 and 65',async()=>{
  const {data,error}=await owner.from('liquidity_settlements').select('financial_event_id,account_id,direction,amount,base_amount,status').eq('organization_id',ORG).in('financial_event_id',[SETTLEMENT_50,SETTLEMENT_65])
  if(error)throw error
  expect(data).toHaveLength(2)
  const amounts=(data||[]).map(x=>n(x.amount)).sort((a,b)=>a-b)
  expect(amounts).toEqual([50,65])
  expect(data?.every(x=>x.account_id===ACCOUNT&&x.direction==='OUTFLOW'&&x.status==='POSTED')).toBe(true)
 },30000)

 it('allocates the two settlement events as 50 and 65 to the same expected flow',async()=>{
  const {data,error}=await owner.from('liquidity_flow_settlement_allocations').select('financial_event_id,flow_id,amount,base_amount,allocation_type').eq('organization_id',ORG).in('financial_event_id',[SETTLEMENT_50,SETTLEMENT_65])
  if(error)throw error
  expect(data).toHaveLength(2)
  const partial=data?.find(x=>x.financial_event_id===SETTLEMENT_50)
  const final=data?.find(x=>x.financial_event_id===SETTLEMENT_65)
  expect(n(partial?.amount)).toBe(50)
  expect(n(final?.amount)).toBe(65)
  expect(partial?.flow_id).toBe(final?.flow_id)
  expect(partial?.allocation_type).toBe('PAYMENT')
  expect(final?.allocation_type).toBe('PAYMENT')
 },30000)

 it('reconciles recognition and both settlement events as MATCHED',async()=>{
  const {data,error}=await owner.from('financial_core_cash_reconciliation').select('financial_event_id,event_type,reconciliation_status,cash_settled_amount').eq('organization_id',ORG).eq('liquidity_flow_id','f9c8ea81-b91e-4555-b187-2d159265d7b4')
  if(error)throw error
  expect(data).toHaveLength(3)
  expect(data?.every(x=>x.reconciliation_status==='MATCHED'&&n(x.cash_settled_amount)===115)).toBe(true)
  expect(data?.filter(x=>x.event_type==='SETTLEMENT')).toHaveLength(2)
  expect(data?.filter(x=>x.financial_event_id===RECOGNITION)).toHaveLength(1)
 },30000)

 it('reports the expected flow as fully settled with no outstanding cash',async()=>{
  const {data,error}=await owner.from('liquidity_flow_settlement_reconciliation').select('expected_amount,settled_amount,expected_outstanding,settlement_status,net_actual_cash_allocated').eq('organization_id',ORG).eq('flow_id','f9c8ea81-b91e-4555-b187-2d159265d7b4').single()
  if(error)throw error
  expect(n(data.expected_amount)).toBe(115)
  expect(n(data.settled_amount)).toBe(115)
  expect(n(data.expected_outstanding)).toBe(0)
  expect(n(data.net_actual_cash_allocated)).toBe(115)
  expect(data.settlement_status).toBe('SETTLED')
 },30000)

 it('moves the operating cash account by 115 exactly once',async()=>{
  const {data,error}=await owner.from('liquidity_accounts').select('current_balance').eq('organization_id',ORG).eq('id',ACCOUNT).single()
  if(error)throw error
  expect(n(data.current_balance)).toBe(-115)
  console.log('CASH_E2E_SETTLEMENT=50+65=115')
  console.log('CASH_E2E_OUTSTANDING=0')
  console.log('CASH_E2E_ACCOUNT_BALANCE=-115')
 },30000)
})
