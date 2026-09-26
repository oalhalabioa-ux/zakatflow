import { NextResponse } from 'next/server';
import { vatContactSchema } from '@/lib/validation/schemas';
import { requireUser } from '@/services/auth';
import { requireOrganizationAdmin, requireOrganizationMember } from '@/services/organization-access';

function errorStatus(message: string) {
  if (message === 'UNAUTHORIZED') return 401;
  if (message === 'ORGANIZATION_ACCESS_REQUIRED' || message === 'ORGANIZATION_ADMIN_REQUIRED') return 403;
  return 400;
}

export async function GET(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const params = new URL(request.url).searchParams;
    const organizationId = params.get('organization_id');
    const role = params.get('role');
    if (!organizationId) return NextResponse.json({ error: 'ORGANIZATION_ID_REQUIRED' }, { status: 400 });
    const membership = await requireOrganizationMember(supabase, user.id, organizationId);

    let query = supabase.from('vat_contacts').select('*').eq('organization_id', organizationId).order('name');
    if (role === 'CUSTOMER' || role === 'SUPPLIER') query = query.in('contact_type', [role, 'BOTH']);
    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({
      contacts: data ?? [],
      can_manage: ['OWNER', 'ADMIN'].includes(membership.role),
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
    return NextResponse.json({ error: message }, { status: errorStatus(message), headers: { 'Cache-Control': 'no-store' } });
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    let body: unknown;
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'INVALID_JSON_BODY' }, { status: 400 }); }
    const parsed = vatContactSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'INVALID_VAT_CONTACT', issues: parsed.error.issues.map(({ path, message }) => ({ path, message })) }, { status: 400 });
    }
    const contact = parsed.data;
    await requireOrganizationAdmin(supabase, user.id, contact.organization_id);
    const values = {
      ...contact,
      vat_number: contact.vat_number?.trim() || null,
      email: contact.email?.trim() || null,
      phone: contact.phone?.trim() || null,
      street: contact.street?.trim() || null,
      building_number: contact.building_number?.trim() || null,
      district: contact.district?.trim() || null,
      additional_number: contact.additional_number?.trim() || null,
      city: contact.city?.trim() || null,
      postal_code: contact.postal_code?.trim() || null,
      updated_at: new Date().toISOString(),
      created_by: user.id,
    };
    const { data, error } = await supabase.from('vat_contacts').insert(values).select('*').single();
    if (error?.code === '23505') return NextResponse.json({ error: 'VAT_CONTACT_EXISTS' }, { status: 409 });
    if (error) throw error;
    await supabase.from('audit_logs').insert({
      user_id: user.id,
      entity_type: 'vat_contact',
      entity_id: data.id,
      action: 'CREATE',
      new_data: { organization_id: data.organization_id, contact_type: data.contact_type, name: data.name },
    });
    return NextResponse.json(data, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
    return NextResponse.json({ error: message }, { status: errorStatus(message), headers: { 'Cache-Control': 'no-store' } });
  }
}
