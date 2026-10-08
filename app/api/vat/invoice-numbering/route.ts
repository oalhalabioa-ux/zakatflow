import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/services/auth';
import { requireOrganizationAdmin } from '@/services/organization-access';
import { requestErrorMessage } from '@/lib/vat-invoice-workflow';

const requestSchema = z.object({ organization_id: z.uuid(), first_number: z.string().trim().max(100).nullable().optional() });
function failure(error: unknown) {
  const code = requestErrorMessage(error);
  const known = ['UNAUTHORIZED','ORGANIZATION_ACCESS_REQUIRED','ORGANIZATION_ADMIN_REQUIRED','INVOICE_SEQUENCE_START_INVALID','INVOICE_SEQUENCE_START_EXISTS','INVOICE_SEQUENCE_EXHAUSTED'];
  return NextResponse.json({error:known.includes(code)?code:'INVOICE_NUMBERING_FAILED'}, {status:code==='UNAUTHORIZED'?401:code.includes('REQUIRED')?403:known.includes(code)?400:500});
}
export async function GET(request: Request) {
  try {
    const {supabase,user}=await requireUser();
    const organizationId=new URL(request.url).searchParams.get('organization_id');
    if (!z.uuid().safeParse(organizationId).success) return NextResponse.json({error:'INVALID_ORGANIZATION_ID'},{status:400});
    await requireOrganizationAdmin(supabase,user.id,organizationId!);
    const {data,error}=await supabase.rpc('peek_vat_invoice_number',{p_organization_id:organizationId});
    if(error) throw error;
    return NextResponse.json(data,{headers:{'Cache-Control':'no-store'}});
  } catch(error) {return failure(error);}
}
export async function POST(request: Request) {
  try {
    const {supabase,user}=await requireUser();
    const parsed=requestSchema.safeParse(await request.json().catch(() => null));
    if(!parsed.success) return NextResponse.json({error:'INVOICE_SEQUENCE_START_INVALID'},{status:400});
    await requireOrganizationAdmin(supabase,user.id,parsed.data.organization_id);
    const {data,error}=await supabase.rpc('reserve_vat_invoice_number',{p_organization_id:parsed.data.organization_id,p_first_number:parsed.data.first_number??null});
    if(error) throw error;
    return NextResponse.json({invoice_number:data},{headers:{'Cache-Control':'no-store'}});
  } catch(error) {return failure(error);}
}
