import { NextResponse } from 'next/server';
import { requireUser } from '@/services/auth';
import { requireOrganizationAdmin } from '@/services/organization-access';
import { z } from 'zod';

export const runtime = 'nodejs';

const issueSchema = z.object({
  organization_id: z.string().uuid(),
  invoice_id: z.string().uuid(),
  entity_id: z.string().uuid().optional(),
});

function firstRow<T>(data: T | T[] | null): T | null {
  return Array.isArray(data) ? (data[0] ?? null) : data;
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const parsed = issueSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: 'INVALID_ISSUE_REQUEST' }, { status: 400 });
    const body = parsed.data;
    await requireOrganizationAdmin(supabase, user.id, body.organization_id);

    // Validate Financial Core routing before issuing. This prevents an invoice from
    // becoming immutable/issued while its recognition event cannot be prepared.
    const { data: source, error: sourceError } = await supabase.from('vat_einvoices')
      .select('id,organization_id,status,due_date,buyer_contact_id')
      .eq('id', body.invoice_id)
      .eq('organization_id', body.organization_id)
      .maybeSingle();
    if (sourceError) throw sourceError;
    if (!source) throw new Error('EINVOICE_NOT_FOUND');
    if (source.status !== 'DRAFT') throw new Error('EINVOICE_NOT_DRAFT');
    if (!source.due_date) throw new Error('EINVOICE_DUE_DATE_REQUIRED_FOR_FINANCIAL_CORE');
    if (!source.buyer_contact_id) throw new Error('EINVOICE_BUYER_CONTACT_REQUIRED_FOR_FINANCIAL_CORE');

    let entityId = body.entity_id ?? null;
    if (entityId) {
      const { data: entity, error: entityError } = await supabase.from('organization_entities')
        .select('id')
        .eq('id', entityId)
        .eq('organization_id', body.organization_id)
        .eq('active', true)
        .maybeSingle();
      if (entityError) throw entityError;
      if (!entity) throw new Error('EINVOICE_FINANCIAL_ENTITY_INVALID');
    } else {
      const { data: entities, error: entitiesError } = await supabase.from('organization_entities')
        .select('id')
        .eq('organization_id', body.organization_id)
        .eq('active', true)
        .order('created_at')
        .limit(2);
      if (entitiesError) throw entitiesError;
      if ((entities ?? []).length !== 1) throw new Error('EINVOICE_FINANCIAL_ENTITY_REQUIRED');
      entityId = entities![0].id;
    }

    const { data: issueData, error: issueError } = await supabase.rpc('issue_vat_einvoice', { p_invoice_id: body.invoice_id });
    if (issueError) throw issueError;
    const invoice = firstRow(issueData);
    if (!invoice || (invoice as { organization_id?: string }).organization_id !== body.organization_id) throw new Error('EINVOICE_NOT_FOUND');

    // Recognition is created through the existing Phase 2C adapter. It remains
    // COMMITTED until independently approved and posted; settlement stays separate.
    const { data: eventData, error: eventError } = await supabase.rpc('prepare_vat_financial_event', {
      p_source_table: 'vat_einvoices',
      p_source_id: body.invoice_id,
      p_entity_id: entityId,
      p_due_date: source.due_date,
    });
    if (eventError) throw eventError;
    const financialEventId = firstRow(eventData);
    if (!financialEventId) throw new Error('VAT_FINANCIAL_EVENT_NOT_CREATED');

    return NextResponse.json({
      ...(invoice as Record<string, unknown>),
      financial_core: {
        event_id: financialEventId,
        status: 'COMMITTED',
        recognition: 'PENDING_INDEPENDENT_APPROVAL',
      },
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const details = error instanceof Error ? error.message : '';
    const known: Record<string, number> = {
      UNAUTHORIZED: 401,
      ORGANIZATION_ACCESS_REQUIRED: 403,
      ORGANIZATION_ADMIN_REQUIRED: 403,
      VAT_REGISTRATION_REQUIRED: 409,
      EINVOICE_NOT_FOUND: 404,
      EINVOICE_NOT_DRAFT: 409,
      NOTE_ISSUANCE_NOT_SUPPORTED: 409,
      EINVOICE_DUE_DATE_REQUIRED_FOR_FINANCIAL_CORE: 409,
      EINVOICE_BUYER_CONTACT_REQUIRED_FOR_FINANCIAL_CORE: 409,
      EINVOICE_FINANCIAL_ENTITY_INVALID: 409,
      EINVOICE_FINANCIAL_ENTITY_REQUIRED: 409,
      VAT_FINANCIAL_CLASSIFICATIONS_REQUIRED: 409,
      VAT_FINANCIAL_PREPARE_DENIED: 403,
      VAT_FINANCIAL_EVENT_NOT_CREATED: 500,
      QR_FIELD_TOO_LONG: 400,
      QR_PAYLOAD_TOO_LONG: 400,
    };
    const code = Object.keys(known).find((key) => details.includes(key)) ?? 'EINVOICE_ISSUE_FAILED';
    return NextResponse.json({ error: known[code] ? code : 'EINVOICE_ISSUE_FAILED' }, {
      status: known[code] ?? 500,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}
