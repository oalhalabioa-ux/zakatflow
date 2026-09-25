import { NextResponse } from 'next/server';
import Decimal from 'decimal.js';
import { vatDocumentSchema, vatProfileSchema } from '@/lib/validation/schemas';
import { getVatPeriod, type VatFilingFrequency } from '@/lib/vat-period';
import { calculateVatAmounts } from '@/lib/vat';
import { requireUser } from '@/services/auth';
import { requireOrganizationAdmin, requireOrganizationMember } from '@/services/organization-access';

const errorStatus = (message: string) => {
  if (message === 'UNAUTHORIZED') return 401;
  if (message === 'ORGANIZATION_ADMIN_REQUIRED') return 403;
  if (message === 'ORGANIZATION_ACCESS_REQUIRED') return 403;
  if (message === 'VAT_PROFILE_REQUIRED') return 409;
  return 400;
};

export async function GET(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const params = new URL(request.url).searchParams;
    const organizationId = params.get('organization_id');
    const periodMonth = params.get('period_month') ?? new Date().toISOString().slice(0, 7);
    if (!organizationId) return NextResponse.json({ error: 'ORGANIZATION_ID_REQUIRED' }, { status: 400 });
    await requireOrganizationMember(supabase, user.id, organizationId);

    const profileResult = await supabase.from('vat_profiles').select('*').eq('organization_id', organizationId).maybeSingle();
    if (profileResult.error) throw profileResult.error;
    const period = getVatPeriod(
      periodMonth,
      (profileResult.data?.filing_frequency ?? 'QUARTERLY') as VatFilingFrequency,
      Number(profileResult.data?.period_start_month ?? 1),
    );
    const documents: Record<string, any>[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabase
        .from('vat_documents')
        .select('*')
        .eq('organization_id', organizationId)
        .gte('transaction_date', period.from)
        .lte('transaction_date', period.to)
        .order('transaction_date', { ascending: false })
        .order('created_at', { ascending: false })
        .range(offset, offset + 999);
      if (error) throw error;
      documents.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    const { data: issuedInvoices, error: invoiceError } = await supabase.from('vat_einvoices')
      .select('id,invoice_number,invoice_category,issue_date,buyer_name,buyer_vat_number,organization_id')
      .eq('organization_id', organizationId)
      .eq('status', 'ISSUED')
      .gte('issue_date', period.from)
      .lte('issue_date', period.to)
      .order('issue_date', { ascending: false });
    if (invoiceError) throw invoiceError;
    const invoiceIds = (issuedInvoices ?? []).map((invoice: { id: string }) => invoice.id);
    const { data: invoiceLines, error: invoiceLinesError } = invoiceIds.length
      ? await supabase.from('vat_einvoice_lines').select('invoice_id,tax_category,tax_rate,line_extension_amount,tax_amount').in('invoice_id', invoiceIds)
      : { data: [], error: null };
    if (invoiceLinesError) throw invoiceLinesError;
    const invoicesById = new Map((issuedInvoices ?? []).map((invoice: any) => [invoice.id, invoice]));
    const summaries = new Map<string, any>();
    for (const line of invoiceLines ?? []) {
      const invoice = invoicesById.get(line.invoice_id);
      if (!invoice) continue;
      const key = `${invoice.id}:${line.tax_category}:${line.tax_rate}`;
      const summary = summaries.get(key) ?? {
        id: `einvoice-${key}`,
        organization_id: organizationId,
        document_type: 'SALES',
        document_kind: 'INVOICE',
        document_number: invoice.invoice_number,
        transaction_date: invoice.issue_date,
        counterparty_name: invoice.buyer_name || invoice.invoice_category,
        counterparty_tax_number: invoice.buyer_vat_number,
        supply_type: ({ S: 'STANDARD', Z: 'ZERO_RATED', E: 'EXEMPT', O: 'OUT_OF_SCOPE' } as Record<string, string>)[line.tax_category],
        tax_rate: line.tax_rate,
        recoverable_percent: '100.00',
        net_amount: new Decimal(0),
        tax_amount: new Decimal(0),
        gross_amount: new Decimal(0),
        is_einvoice: true,
      };
      summary.net_amount = summary.net_amount.plus(line.line_extension_amount);
      summary.tax_amount = summary.tax_amount.plus(line.tax_amount);
      summary.gross_amount = summary.gross_amount.plus(line.line_extension_amount).plus(line.tax_amount);
      summaries.set(key, summary);
    }
    const issuedDocumentSummaries = Array.from(summaries.values(), (summary) => ({
      ...summary,
      net_amount: summary.net_amount.toFixed(2),
      tax_amount: summary.tax_amount.toFixed(2),
      gross_amount: summary.gross_amount.toFixed(2),
    }));
    return NextResponse.json({ profile: profileResult.data, period, documents: [...documents, ...issuedDocumentSummaries] });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: errorStatus(error.message) });
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const body = await request.json();

    if (body.action === 'save_profile') {
      const profile = vatProfileSchema.parse(body);
      await requireOrganizationAdmin(supabase, user.id, profile.organization_id);
      const { data: existing, error: existingError } = await supabase
        .from('vat_profiles')
        .select('id')
        .eq('organization_id', profile.organization_id)
        .maybeSingle();
      if (existingError) throw existingError;
      const profileValues = {
        ...profile,
        tax_registration_number: profile.tax_registration_number?.trim() || null,
        registration_date: profile.registration_date || null,
        updated_at: new Date().toISOString(),
      };
      const saveQuery = existing
        ? supabase.from('vat_profiles').update(profileValues).eq('id', existing.id)
        : supabase.from('vat_profiles').insert({ ...profileValues, created_by: user.id });
      const { data, error } = await saveQuery.select().single();
      if (error) throw error;
      await supabase.from('audit_logs').insert({
        user_id: user.id,
        entity_type: 'vat_profile',
        entity_id: data.id,
        action: 'UPSERT',
        new_data: { ...data, tax_registration_number: data.tax_registration_number ? 'REDACTED' : null },
      });
      return NextResponse.json(data);
    }

    if (body.action === 'add_document') {
      const document = vatDocumentSchema.parse(body);
      await requireOrganizationAdmin(supabase, user.id, document.organization_id);
      const { data: profile, error: profileError } = await supabase
        .from('vat_profiles')
        .select('registration_status,standard_rate')
        .eq('organization_id', document.organization_id)
        .single();
      if (profileError?.code === 'PGRST116') throw new Error('VAT_PROFILE_REQUIRED');
      if (profileError) throw profileError;
      if (profile.registration_status !== 'REGISTERED') throw new Error('VAT_REGISTRATION_REQUIRED');

      const taxRate = document.supply_type === 'STANDARD' ? Number(profile.standard_rate) : 0;
      const amounts = calculateVatAmounts(document.net_amount, taxRate);
      const { data, error } = await supabase.from('vat_documents').insert({
        organization_id: document.organization_id,
        user_id: user.id,
        created_by: user.id,
        document_type: document.document_type,
        document_kind: document.document_kind,
        document_number: document.document_number,
        transaction_date: document.transaction_date,
        counterparty_name: document.counterparty_name,
        counterparty_tax_number: document.counterparty_tax_number?.trim() || null,
        supply_type: document.supply_type,
        net_amount: amounts.netAmount,
        tax_rate: taxRate.toFixed(2),
        tax_amount: amounts.taxAmount,
        recoverable_percent: document.document_type === 'PURCHASE' ? document.recoverable_percent : 100,
        gross_amount: amounts.grossAmount,
        currency: 'SAR',
        notes: document.notes?.trim() || null,
      }).select().single();
      if (error?.code === '23505') return NextResponse.json({ error: 'VAT_DOCUMENT_NUMBER_EXISTS' }, { status: 409 });
      if (error) throw error;
      await supabase.from('audit_logs').insert({
        user_id: user.id,
        entity_type: 'vat_document',
        entity_id: data.id,
        action: 'CREATE',
        new_data: { id: data.id, organization_id: data.organization_id, document_type: data.document_type, document_number: data.document_number, transaction_date: data.transaction_date, net_amount: data.net_amount, tax_amount: data.tax_amount },
      });
      return NextResponse.json(data, { status: 201 });
    }

    return NextResponse.json({ error: 'INVALID_VAT_ACTION' }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: errorStatus(error.message) });
  }
}

export async function DELETE(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const params = new URL(request.url).searchParams;
    const organizationId = params.get('organization_id');
    const documentId = params.get('document_id');
    if (!organizationId || !documentId) return NextResponse.json({ error: 'VAT_DOCUMENT_ID_REQUIRED' }, { status: 400 });
    await requireOrganizationAdmin(supabase, user.id, organizationId);
    const { data, error } = await supabase
      .from('vat_documents')
      .delete()
      .eq('organization_id', organizationId)
      .eq('id', documentId)
      .select('id,document_number,document_type')
      .single();
    if (error) throw error;
    await supabase.from('audit_logs').insert({ user_id: user.id, entity_type: 'vat_document', entity_id: data.id, action: 'DELETE', old_data: data });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: errorStatus(error.message) });
  }
}
