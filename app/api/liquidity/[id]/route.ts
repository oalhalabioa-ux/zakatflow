import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/services/auth';
import { requireOrganizationMember } from '@/services/organization-access';
const canWrite=async(supabase:any,userId:string,organizationId:string)=>{const{data}=await supabase.from('organization_members').select('role').eq('organization_id',organizationId).eq('user_id',userId).eq('status','ACTIVE').maybeSingle();return !!data&&['OWNER','ADMIN','ACCOUNTANT','ADVISOR'].includes(data.role)};
const schema=z.object({status:z.enum(['ACTUAL','CONFIRMED','EXPECTED']).optional(),due_date:z.string().date().optional(),title:z.string().trim().min(1).max(160).optional(),counterparty:z.string().max(160).optional(),amount:z.coerce.number().positive().optional(),base_amount:z.coerce.number().positive().optional(),notes:z.string().max(500).optional(),reference:z.string().max(120).optional()}).refine(v=>Object.keys(v).length>0);
export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}){try{const{id}=await params;const{supabase,user}=await requireUser();const body=schema.parse(await request.json());const{data:record,error:lookupError}=await supabase.from('liquidity_flows').select('id,organization_id').eq('id',id).maybeSingle();if(lookupError)throw lookupError;if(!record)return NextResponse.json({error:'LIQUIDITY_RECORD_NOT_FOUND'},{status:404});await requireOrganizationMember(supabase,user.id,record.organization_id);if(!await canWrite(supabase,user.id,record.organization_id))return NextResponse.json({error:'ORGANIZATION_ADMIN_REQUIRED'},{status:403});const{data,error}=await supabase.from('liquidity_flows').update({...body,updated_at:new Date().toISOString()}).eq('id',id).select().single();if(error)throw error;return NextResponse.json(data)}catch(error){const message=error instanceof Error?error.message:'LIQUIDITY_UPDATE_FAILED';return NextResponse.json({error:message},{status:message==='UNAUTHORIZED'?401:/ACCESS_REQUIRED/.test(message)?403:400})}}
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { supabase, user } = await requireUser();
    const { data: account } = await supabase.from('liquidity_accounts').select('id,organization_id').eq('id', id).maybeSingle();
    const { data: flow } = account ? { data: null } : await supabase.from('liquidity_flows').select('id,organization_id').eq('id', id).maybeSingle();
    const record = account ?? flow;
    if (!record) return NextResponse.json({ error: 'LIQUIDITY_RECORD_NOT_FOUND' }, { status: 404 });
    await requireOrganizationMember(supabase, user.id, record.organization_id);
    if (!await canWrite(supabase,user.id,record.organization_id)) return NextResponse.json({ error: 'ORGANIZATION_ADMIN_REQUIRED' }, { status: 403 });
    const result = account ? await supabase.from('liquidity_accounts').delete().eq('id', id) : await supabase.from('liquidity_flows').delete().eq('id', id);
    if (result.error) throw result.error;
    return NextResponse.json({ ok: true });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'LIQUIDITY_DELETE_FAILED' }, { status: error instanceof Error && error.message === 'UNAUTHORIZED' ? 401 : 400 }); }
}
