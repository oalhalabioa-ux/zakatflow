import { NextResponse } from 'next/server';
import { requireUser } from '@/services/auth';
import { requireOrganizationMember } from '@/services/organization-access';
export async function GET(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const params = new URL(request.url).searchParams;
    const organizationId = params.get('organization_id'), documentId = params.get('document_id');
    if (!organizationId) return NextResponse.json({error:'ORGANIZATION_ID_REQUIRED'},{status:400});
    const membership = await requireOrganizationMember(supabase,user.id,organizationId);
    const [doc,profile,org] = await Promise.all([
      documentId ? supabase.from('vat_documents').select('*').eq('organization_id',organizationId).eq('id',documentId).maybeSingle() : {data:null,error:null},
      supabase.from('vat_profiles').select('*').eq('organization_id',organizationId).maybeSingle(),
      supabase.from('organizations').select('name,base_currency').eq('id',organizationId).single(),
    ]);
    for (const result of [doc,profile,org]) if (result.error) throw result.error;
    if (documentId && !doc.data) return NextResponse.json({error:'VAT_DOCUMENT_NOT_FOUND'},{status:404});
    return NextResponse.json({document:doc.data,profile:profile.data,organization:org.data,is_admin:['OWNER','ADMIN'].includes(membership.role)},{headers:{'Cache-Control':'no-store'}});
  } catch(error) { const message=error instanceof Error?error.message:''; const status=message==='UNAUTHORIZED'?401:message==='ORGANIZATION_ACCESS_REQUIRED'?403:500;return NextResponse.json({error:status===500?'REGISTER_LOAD_FAILED':message},{status}); }
}
