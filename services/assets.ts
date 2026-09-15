import { requireUser } from './auth';
import { assetSchema } from '@/lib/validation/schemas';
export async function listAssets(){ const {supabase,user}=await requireUser(); const {data,error}=await supabase.from('asset_accounts').select('*').eq('user_id',user.id).order('created_at',{ascending:false}); if(error) throw error; return data; }
export async function createAsset(input:unknown){ const parsed=assetSchema.parse(input); const {supabase,user}=await requireUser(); const {data,error}=await supabase.from('asset_accounts').insert({...parsed,user_id:user.id}).select().single(); if(error) throw error; return data; }
