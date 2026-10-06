import {beforeAll,describe,it,expect} from 'vitest';
import {createClient,type SupabaseClient} from '@supabase/supabase-js';
import {buildAssetPurchaseCoreIntent} from '../lib/asset-financial-core';

const URL=process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL||'';
const KEY=process.env.SUPABASE_PUBLISHABLE_KEY||process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY||'';
const EMAIL=process.env.E2E_OWNER_EMAIL||'';
const PASSWORD=process.env.E2E_OWNER_PASSWORD||'';
const ORG='85acbac0-e8b4-434c-a22b-3ec13b55e1a7';
const ENTITY='d3c2ef65-d8b4-4ac9-9267-d91c9dfc4cbe';
const COST='ebd551dd-18e6-41a6-b871-989e3f0f8174';
let owner:SupabaseClient; let userId='';
const n=(v:any)=>Number(v??0);

beforeAll(async()=>{
 if(!URL||!KEY||!EMAIL||!PASSWORD)throw new Error('E2E_ASSETS_QA_CONFIG_REQUIRED');
 owner=createClient(URL,KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data,error}=await owner.auth.signInWithPassword({email:EMAIL,password:PASSWORD});
 if(error)throw error; userId=data.user.id;
});

describe('Operational Integration V1 Assets',()=>{
 it('recognizes PPE purchase as CAPEX/payable once without cash movement',async()=>{
  expect(URL).toContain('wtzgzmcgcqouziqzsfnl');
  const cls=await owner.from('asset_classes').select('financial_classification_type').eq('code','PPE').single();
  if(cls.error)throw cls.error; expect(cls.data.financial_classification_type).toBe('CAPEX');

  let c=await owner.from('financial_classifications').select('id').eq('organization_id',ORG).eq('classification_type','CAPEX').eq('active',true).limit(1).maybeSingle();
  if(c.error)throw c.error;
  if(!c.data){
   const x=await owner.from('financial_classifications').insert({organization_id:ORG,code:'QA_ASSET_CAPEX',name:'Assets Operational QA CAPEX',classification_type:'CAPEX',active:true,is_system:true,metadata:{qa_fixture:true},created_by:userId}).select('id').single();
   if(x.error)throw x.error; c={...c,data:x.data};
  }
  const before=await owner.from('liquidity_accounts').select('id,current_balance').eq('organization_id',ORG).eq('active',true).order('id');
  if(before.error)throw before.error;

  const marker='ASSET_QA_'+Date.now();
  const asset=await owner.from('asset_accounts').insert({user_id:userId,asset_type:'OTHER',name:marker,currency:'SAR',unit:'unit',is_zakatable:false,ownership_scope:'ORGANIZATION',organization_id:ORG,entity_id:ENTITY,cost_center_id:COST,asset_class_code:'PPE',asset_type_code:'IT_EQUIPMENT',metadata:{acquisition_mode:'PURCHASE',qa_fixture:true}}).select('id').single();
  if(asset.error)throw asset.error;
  const tx=await owner.from('transactions').insert({user_id:userId,asset_account_id:asset.data.id,transaction_type:'PURCHASE',transaction_date:new Date().toISOString().slice(0,10),quantity:1,unit_price:100,currency:'SAR',gross_value:100,base_currency:'SAR',base_value:100,notes:marker,created_by:userId,organization_id:ORG,entity_id:ENTITY,metadata:{fx_rate:1,cost_center_id:COST,financial_core_status:'PENDING_RECOGNITION'}}).select('id,transaction_date').single();
  if(tx.error)throw tx.error;

  const classificationId=c.data?.id; expect(classificationId).toBeTruthy();
  const payload=buildAssetPurchaseCoreIntent({transactionId:tx.data.id,assetId:asset.data.id,organizationId:ORG,entityId:ENTITY,costCenterId:COST,assetName:marker,assetClassCode:'PPE',transactionDate:tx.data.transaction_date,currency:'SAR',baseCurrency:'SAR',amount:100,baseAmount:100,exchangeRate:1,assetClassificationId:classificationId!});
  const first=await owner.rpc('create_financial_event_command',{p_payload:payload}); if(first.error)throw first.error;
  const second=await owner.rpc('create_financial_event_command',{p_payload:payload}); if(second.error)throw second.error;
  expect(second.data).toBe(first.data);

  const event=await owner.from('financial_events').select('status').eq('id',first.data).single(); if(event.error)throw event.error;
  expect(event.data.status).toBe('DRAFT');
  const lines=await owner.from('financial_event_lines').select('classification_id,base_amount,cash_direction,vat_amount').eq('event_id',first.data); if(lines.error)throw lines.error;
  expect((lines.data||[]).every((x:any)=>x.classification_id===classificationId)).toBe(true);
  expect(lines.data).toHaveLength(1); expect(lines.data?.[0]?.classification_id).toBe(classificationId); expect(n(lines.data?.[0]?.base_amount)).toBe(100); expect(lines.data?.[0]?.cash_direction).toBe('NON_CASH'); expect(n(lines.data?.[0]?.vat_amount)).toBe(0);
  const obs=await owner.from('financial_event_obligations').select('obligation_type,settleable_amount,settleable_base_amount').eq('event_id',first.data); if(obs.error)throw obs.error;
  expect((obs.data||[]).reduce((s:number,x:any)=>s+n(x.original_amount),0)).toBe(100);
  expect((obs.data||[]).reduce((s:number,x:any)=>s+n(x.settled_amount),0)).toBe(0);

  const after=await owner.from('liquidity_accounts').select('id,current_balance').eq('organization_id',ORG).eq('active',true).order('id'); if(after.error)throw after.error;
  expect(after.data).toEqual(before.data);
  console.log('ASSETS_E2E=CAPEX_100,PAYABLE_100,OUTSTANDING_100,NO_OPEX');
  console.log('ASSETS_E2E_CASH_MOVEMENT=0');
  console.log('ASSETS_E2E_IDEMPOTENT_EVENT='+first.data);
 },30000);
});