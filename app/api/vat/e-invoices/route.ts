import { NextResponse } from 'next/server';
import { calculateVatEInvoiceDraft, vatEInvoiceDraftSchema } from '@/lib/vat-einvoice-draft';
import { requireUser } from '@/services/auth';
import { requireOrganizationAdmin, requireOrganizationMember } from '@/services/organization-access';

export const runtime = 'nodejs';

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
  const known = new Set([
    'UNAUTHORIZED', 'ORGANIZATION_ACCESS_REQUIRED', 'ORGANIZATION_ADMIN_REQUIRED',
    'VAT_PROFILE_REQUIRED', 'VAT_REGISTRATION_REQUIRED', 'SELLER_VAT_MISMATCH',
    'EINVOICE_CONNECTION_MISMATCH', 'PRECEDING_INVOICE_NOT_ISSUED',
    'NOTE_INVOICE_CATEGORY_MISMATCH', 'EINVOICE_NUMBER_EXISTS',
  ]);
  const code = known.has(message) || message.startsWith('LINE_DISCOUNT_EXCEEDS_AMOUNT:')
    ? message
    : 'EINVOICE_REQUEST_FAILED';
  const status = code === 'UNAUTHORIZED' ? 401
    : code === 'ORGANIZATION_ACCESS_REQUIRED' || code === 'ORGANIZATION_ADMIN_REQUIRED' ? 403
      : ['VAT_PROFILE_REQUIRED', 'VAT_REGISTRATION_REQUIRED', 'SELLER_VAT_MISMATCH', 'PRECEDING_INVOICE_NOT_ISSUED', 'EINVOICE_NUMBER_EXISTS'].includes(code) ? 409
        : code === 'EINVOICE_REQUEST_FAILED' ? 500 : 400;
  return NextResponse.json({ error: code }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function GET(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const organizationId = new URL(request.url).searchParams.get('organization_id');
    if (!organizationId) return NextResponse.json({ error: 'ORGANIZATION_ID_REQUIRED' }, { status: 400 });
    const membership = await requireOrganizationMember(supabase, user.id, organizationId);
    const { data: invoices, error } = await supabase.from('vat_einvoices')
      .select('*')
      .eq('organization_id', organizationId)
      .order('issue_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) throw error;
    const ids = (invoices ?? []).map((invoice: { id: string }) => invoice.id);
    const { data: lines, error: lineError } = ids.length
      ? await supabase.from('vat_einvoice_lines').select('*').in('invoice_id', ids).order('line_number')
      : { data: [], error: null };
    if (lineError) throw lineError;
    const linesByInvoice = new Map<string, unknown[]>();
    for (const line of lines ?? []) {
      const invoiceLines = linesByInvoice.get(line.invoice_id) ?? [];
      invoiceLines.push(line);
      linesByInvoice.set(line.invoice_id, invoiceLines);
    }
    return NextResponse.json({ is_admin: ['OWNER', 'ADMIN'].includes(membership.role), invoices: (invoices ?? []).map((invoice: { id: string }) => ({
      ...invoice,
      lines: linesByInvoice.get(invoice.id) ?? [],
    })) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  let createdInvoiceId: string | null = null;
  try {
    const { supabase, user } = await requireUser();
    let requestBody: unknown;
    try {
      requestBody = await request.json();
    } catch {
      return NextResponse.json({ error: 'INVALID_JSON_BODY' }, { status: 400 });
    }
    const parsed = vatEInvoiceDraftSchema.safeParse(requestBody);
    if (!parsed.success) {
      return NextResponse.json({ error: 'INVALID_EINVOICE_DRAFT', issues: parsed.error.issues.map(({ path, message }) => ({ path, message })) }, { status: 400 });
    }
    const draft = parsed.data;
    await requireOrganizationAdmin(supabase, user.id, draft.organization_id);

    const { data: profile, error: profileError } = await supabase.from('vat_profiles')
      .select('registration_status,tax_registration_number')
      .eq('organization_id', draft.organization_id)
      .maybeSingle();
    if (profileError) throw profileError;
    if (!profile) throw new Error('VAT_PROFILE_REQUIRED');
    if (profile.registration_status !== 'REGISTERED') throw new Error('VAT_REGISTRATION_REQUIRED');
    if (profile.tax_registration_number?.trim() !== draft.seller_vat_number) throw new Error('SELLER_VAT_MISMATCH');

    if (draft.connection_id) {
      const { data: connection, error: connectionError } = await supabase.from('vat_einvoice_connections')
        .select('id,organization_id,taxpayer_vat_number,status')
        .eq('id', draft.connection_id)
        .eq('organization_id', draft.organization_id)
        .maybeSingle();
      if (connectionError) throw connectionError;
      if (!connection || connection.taxpayer_vat_number !== draft.seller_vat_number) throw new Error('EINVOICE_CONNECTION_MISMATCH');
    }

    if (draft.preceding_invoice_id) {
      const { data: precedingInvoice, error: precedingError } = await supabase.from('vat_einvoices')
        .select('id,organization_id,status,invoice_category')
        .eq('id', draft.preceding_invoice_id)
        .eq('organization_id', draft.organization_id)
        .maybeSingle();
      if (precedingError) throw precedingError;
      if (!precedingInvoice || !['ISSUED', 'SUBMITTED', 'CLEARED', 'REPORTED'].includes(precedingInvoice.status)) {
        throw new Error('PRECEDING_INVOICE_NOT_ISSUED');
      }
      if (precedingInvoice.invoice_category !== draft.invoice_category) throw new Error('NOTE_INVOICE_CATEGORY_MISMATCH');
    }

    const calculated = calculateVatEInvoiceDraft(draft);
    const { lines, ...header } = draft;
    const { data: invoice, error: insertError } = await supabase.from('vat_einvoices').insert({
      ...header,
      seller_postal_code: draft.seller_postal_code || null,
      buyer_name: draft.buyer_name || null,
      buyer_vat_number: draft.buyer_vat_number || null,
      buyer_address: draft.buyer_address || null,
      buyer_city: draft.buyer_city || null,
      buyer_postal_code: draft.buyer_postal_code || null,
      buyer_country_code: draft.buyer_country_code || null,
      payment_means_code: draft.payment_means_code || null,
      billing_reference: draft.billing_reference || null,
      preceding_invoice_id: draft.preceding_invoice_id || null,
      note_reason: draft.note_reason || null,
      ...calculated.totals,
      status: 'DRAFT',
      created_by: user.id,
    }).select('id,organization_id,invoice_uuid,invoice_number,document_type,invoice_category,status,issue_date,issue_time,currency,created_at').single();
    if (insertError) {
      if (insertError.code === '23505') throw new Error('EINVOICE_NUMBER_EXISTS');
      throw insertError;
    }
    createdInvoiceId = invoice.id;

    const { data: savedLines, error: lineError } = await supabase.from('vat_einvoice_lines').insert(
      calculated.lines.map((line) => ({ ...line, invoice_id: invoice.id }))
    ).select('*');
    if (lineError) throw lineError;

    await supabase.from('audit_logs').insert({
      user_id: user.id,
      entity_type: 'vat_einvoice',
      entity_id: invoice.id,
      action: 'DRAFT_CREATED',
      new_data: {
        organization_id: draft.organization_id,
        invoice_number: draft.invoice_number,
        document_type: draft.document_type,
        invoice_category: draft.invoice_category,
        line_count: lines.length,
        status: 'DRAFT',
      },
    });
    return NextResponse.json({ ...invoice, ...calculated.totals, lines: savedLines ?? [] }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (createdInvoiceId) {
      try {
        const { supabase } = await requireUser();
        await supabase.from('vat_einvoices').delete().eq('id', createdInvoiceId).eq('status', 'DRAFT');
      } catch {
        // Keep the original failure response; a draft can be safely inspected and cleaned up later.
      }
    }
    return errorResponse(error);
  }
}
