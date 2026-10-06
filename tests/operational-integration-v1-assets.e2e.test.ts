import {describe,it,expect} from 'vitest';
import {createClient} from '@supabase/supabase-js';

const ORG='85acbac0-e8b4-434c-a22b-3ec13b55e1a7';
const USER='f10bd630-6e35-4513-a9b3-4908d1b00c3c';
const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}});

describe('Assets operational QA',()=>{
 it('has the QA asset integration prerequisites',async()=>{
  expect(process.env.NEXT_PUBLIC_SUPABASE_URL).toContain('wtzgzmcgcqouziqzsfnl');
  const a=await db.from('asset_classes').select('code,financial_classification_type').eq('code','PPE').single();
  expect(a.error).toBeNull(); expect(a.data?.financial_classification_type).toBe('CAPEX');
  const m=await db.from('organization_members').select('user_id').eq('organization_id',ORG).eq('user_id',USER).eq('status','ACTIVE').single();
  expect(m.error).toBeNull();
 });
});