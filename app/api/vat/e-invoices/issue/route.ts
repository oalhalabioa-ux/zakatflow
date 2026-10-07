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

const PREPARABLE_STATUSES = new Set(['ISSUED', 'SUBMITTED', 'CLEARED', 'REPORTED']);

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

    const { data: source, error: sourceError } = await supabase.from('vat_einvoices')
      .select('*')
      .eq('id', body.invoice_id)
      .eq('organization_id', body.organization_id)
      .maybeSingle();
    if (sourceError) throw sourceError;
    if (!source) throw new Error('EINVOICE_NOT_FOUND');
    if (source.status !== 'DRAFT' && !PREPARABLE_STATUSES.has(source.status)) {
      throw new Error('EINVOICE_NOT_PREPARABLE');
    }
    if (!source.accounting_document_id) throw new Error('EINVOICE_ACCOUNTING_SOURCE_REQUIRED');
    const { data: accountingDocument, error: accountingError } = await supabase.from('vat_documents')
      .select('id,organization_id,document_type,document_number,due_date')
      .eq('id', source.accounting_document_id)
      .eq('organization_id', body.organization_id)
      .maybeSingle();
    if (accountingError) throw accountingError;
    if (!accountingDocument || accountingDocument.document_type !== 'SALES') throw new Error('EINVOICE_ACCOUNTING_SOURCE_REQUIRED');

    // DRAFT is issued once. If issuance succeeded previously but Financial Core
    // preparation failed, an already-issued lifecycle state can safely retry only
    // the idempotent prepare adapter without issuing the invoice again.
    let invoice: Record<string, unknown> = source as Record<string, unknown>;
    if (source.status === 'DRAFT') {
      const { data: issueData, error: issueError } = await supabase.rpc('issue_vat_einvoice', { p_invoice_id: body.invoice_id });
      if (issueError) throw issueError;
      const issued = firstRow(issueData);
      if (!issued || (issued as { organization_id?: string }).organization_id !== body.organization_id) {
        throw new Error('EINVOICE_NOT_FOUND');
      }
      invoice = issued as Record<string, unknown>;
    }

    return NextResponse.json({
      ...invoice,
      accounting_source: {
        document_id: accountingDocument.id,
        status: 'LINKED',
        financial_effect: 'UNCHANGED_ON_ZATCA_ISSUE',
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
      EINVOICE_NOT_PREPARABLE: 409,
      NOTE_ISSUANCE_NOT_SUPPORTED: 409,
      EINVOICE_ACCOUNTING_SOURCE_REQUIRED: 409,
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
