import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isSameOriginRequest } from '../../../../lib/request-origin';
import { requireUser } from '../../../../services/auth';

const invoiceId = z.string().uuid();
const event = z.object({
  documentId: invoiceId,
  requestId: z.string().uuid(),
  dueDate: z.string().date(),
  classification: z.enum(['EXCELLENT', 'GOOD', 'BAD']),
  effectiveDate: z.string().date(),
}).strict();
const selection = 'id,due_date,classification,effective_date,recorded_at';

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'private, no-store' } });
}

function errorResponse(code: string, status: number) {
  return json({ error: code }, status);
}

function authFailure(error: unknown) {
  return error instanceof Error && error.message === 'UNAUTHORIZED'
    ? errorResponse('UNAUTHORIZED', 401)
    : errorResponse('TERMS_UNAVAILABLE', 503);
}

export async function GET(request: Request) {
  if (process.env.NEXT_PUBLIC_PERSONAL_INCOME !== 'true') return errorResponse('UNAVAILABLE', 404);
  const params = new URL(request.url).searchParams;
  const id = invoiceId.safeParse(params.get('document'));
  if (!id.success || [...params].length !== 1) return errorResponse('INVALID_TERMS', 400);

  try {
    const { supabase, user } = await requireUser();
    const invoice = await supabase.from('personal_income_documents')
      .select('id').eq('id', id.data).eq('owner_id', user.id).not('receivable_id', 'is', null).maybeSingle();
    if (invoice.error) return errorResponse('TERMS_UNAVAILABLE', 503);
    if (!invoice.data) return errorResponse('DOCUMENT_NOT_FOUND', 404);

    const result = await supabase.from('personal_invoice_hawl_events')
      .select(selection).eq('document_id', id.data)
      .order('effective_date', { ascending: false }).order('id', { ascending: false });
    if (result.error) return errorResponse('TERMS_UNAVAILABLE', 503);
    return json({ events: result.data });
  } catch (error) {
    return authFailure(error);
  }
}

export async function POST(request: Request) {
  if (process.env.NEXT_PUBLIC_PERSONAL_INCOME !== 'true') return errorResponse('UNAVAILABLE', 404);
  if (!isSameOriginRequest(request)) return errorResponse('ORIGIN_REQUIRED', 403);

  try {
    const { supabase } = await requireUser();
    const parsed = event.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return errorResponse('INVALID_TERMS', 400);
    const input = parsed.data;
    const { data, error } = await supabase.rpc('record_personal_invoice_hawl_event', {
      p_document: input.documentId,
      p_request: input.requestId,
      p_due_date: input.dueDate,
      p_classification: input.classification,
      p_effective_date: input.effectiveDate,
    });

    if (error?.message === 'PERSONAL_INVOICE_HAWL_DOCUMENT_NOT_FOUND') return errorResponse('DOCUMENT_NOT_FOUND', 404);
    if (error?.message === 'PERSONAL_INVOICE_HAWL_EVENT_INVALID') return errorResponse('INVALID_TERMS', 400);
    if (error?.message === 'PERSONAL_INVOICE_HAWL_REQUEST_CONFLICT') return errorResponse('TERMS_CONFLICT', 409);
    if (error || !data) return errorResponse('TERMS_UNAVAILABLE', 503);
    return json({ saved: true });
  } catch (error) {
    return authFailure(error);
  }
}
