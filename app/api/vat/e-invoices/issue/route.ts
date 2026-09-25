import { NextResponse } from 'next/server';
import { requireUser } from '@/services/auth';
import { requireOrganizationAdmin } from '@/services/organization-access';
import { z } from 'zod';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const parsed = z.object({ organization_id: z.string().uuid(), invoice_id: z.string().uuid() }).safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: 'INVALID_ISSUE_REQUEST' }, { status: 400 });
    const body = parsed.data;
    await requireOrganizationAdmin(supabase, user.id, body.organization_id);
    const { data, error } = await supabase.rpc('issue_vat_einvoice', { p_invoice_id: body.invoice_id });
    if (error) throw error;
    const invoice = Array.isArray(data) ? data[0] : data;
    if (!invoice || invoice.organization_id !== body.organization_id) throw new Error('EINVOICE_NOT_FOUND');
    return NextResponse.json(invoice, { headers: { 'Cache-Control': 'no-store' } });
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
