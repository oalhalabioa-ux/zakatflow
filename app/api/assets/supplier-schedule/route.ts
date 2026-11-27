import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isSameOriginRequest } from '../../../../lib/request-origin';
import { createAsset } from '../../../../services/assets';
import { requireUser } from '../../../../services/auth';

const headers = { 'Cache-Control': 'private, no-store' };
const command = z.strictObject({
  request_id: z.uuid(),
  asset: z.record(z.string(), z.unknown()),
  terms: z.strictObject({
    mode: z.enum(['DEFERRED', 'INSTALLMENTS']),
    entries: z.array(z.strictObject({
      kind: z.enum(['DOWN_PAYMENT', 'INSTALLMENT']),
      due_date: z.iso.date(),
      principal: z.string().regex(/^\d{1,12}(\.\d{1,4})?$/),
    })).min(1).max(120),
  }),
});

function fail(error: unknown) {
  const { code, message } = (error ?? {}) as { code?: string; message?: string };
  const status = message === 'UNAUTHORIZED' ? 401
    : message === 'ORIGIN_REQUIRED' || message?.endsWith('_DENIED') ? 403
    : message?.endsWith('_CONFLICT') || message?.endsWith('_DRAFT_REQUIRED') ||
      message === 'ASSET_SUPPLIER_SCHEDULE_REQUIRES_RECONCILIATION' ? 409
    : error instanceof z.ZodError || ['22007','22008','22P02'].includes(code ?? '') ||
      message?.startsWith('ASSET_') || message === 'VALIDATION_FAILED' ? 400 : 500;
  const publicError = status === 500 ? 'ASSET_SUPPLIER_SCHEDULE_FAILED'
    : error instanceof z.ZodError || ['22007','22008','22P02'].includes(code ?? '')
      ? 'ASSET_SUPPLIER_SCHEDULE_INVALID' : message;
  return NextResponse.json({ error: publicError }, { status, headers });
}

export async function POST(request: Request) {
  try {
    if (!isSameOriginRequest(request)) throw Error('ORIGIN_REQUIRED');
    const input = command.parse(await request.json().catch(() => null));
    const asset = await createAsset({ ...input.asset, request_id: input.request_id }, input.terms);
    return NextResponse.json(asset, { status: 201, headers });
  } catch (error) {
    return fail(error);
  }
}

export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams;
    const { asset_id } = z.strictObject({ asset_id: z.uuid() }).parse(Object.fromEntries(query));
    if (query.getAll('asset_id').length !== 1) throw Error('ASSET_SUPPLIER_SCHEDULE_INVALID');
    const { supabase } = await requireUser();
    const { data, error } = await supabase.rpc('read_asset_supplier_schedule', { p_asset_id: asset_id });
    if (error) throw error;
    return NextResponse.json({ schedule: data }, { headers });
  } catch (error) {
    return fail(error);
  }
}
