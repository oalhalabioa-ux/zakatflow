import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isSameOriginRequest } from '../../../../lib/request-origin';
import { requireUser } from '../../../../services/auth';
import { createPersonalSupplierAsset } from '../../../../services/personal-asset-supplier';

const headers = { 'Cache-Control': 'private, no-store' };
const create = z.strictObject({
  request_id: z.uuid(),
  asset: z.record(z.string(), z.unknown()),
  terms: z.strictObject({
    mode: z.enum(['DEFERRED', 'INSTALLMENTS']),
    supplier_name: z.string().trim().min(1).max(120),
    down_payment_account_id: z.uuid().nullable().optional(),
    entries: z.array(z.strictObject({
      kind: z.enum(['DOWN_PAYMENT', 'INSTALLMENT']),
      due_date: z.iso.date(),
      principal: z.string().regex(/^\d{1,12}(\.\d{1,4})?$/),
    })).min(1).max(120),
  }),
});
const reverse = z.strictObject({ action: z.literal('REVERSE'), asset_id: z.uuid() });
const query = z.strictObject({ asset_id: z.uuid(), as_of: z.iso.date().optional() });
const errors = /^(PERSONAL_SUPPLIER_[A-Z_]+|PERSONAL_CASH_ACCESS_DENIED|CASH_INSUFFICIENT_BALANCE|PERSONAL_PAYABLE_BASE_CURRENCY_ONLY|ASSET_REQUEST_CONFLICT|ASSET_ACQUISITION_INVALID|SOURCE_LOT_ALREADY_CONSUMED|VALIDATION_FAILED|UNAUTHORIZED|ORIGIN_REQUIRED)$/;
const conflict = new Set(['ASSET_REQUEST_CONFLICT', 'PERSONAL_SUPPLIER_REVERSE_INSTALLMENTS_FIRST', 'PERSONAL_SUPPLIER_REVERSAL_HAS_ASSET_MOVEMENTS', 'SOURCE_LOT_ALREADY_CONSUMED']);

function fail(error: unknown) {
  const { code, message } = (error ?? {}) as { code?: string; message?: string };
  const invalid = error instanceof z.ZodError || ['22007', '22008', '22P02'].includes(code ?? '');
  const publicError = invalid ? 'PERSONAL_SUPPLIER_SCHEDULE_INVALID'
    : message && errors.test(message) ? message : 'PERSONAL_SUPPLIER_SCHEDULE_FAILED';
  const status = publicError === 'UNAUTHORIZED' ? 401
    : publicError === 'ORIGIN_REQUIRED' || publicError.endsWith('_DENIED') ? 403
    : conflict.has(publicError) ? 409 : publicError === 'PERSONAL_SUPPLIER_SCHEDULE_FAILED' ? 500 : 400;
  return NextResponse.json({ error: publicError }, { status, headers });
}

export async function POST(request: Request) {
  try {
    if (!isSameOriginRequest(request)) throw Error('ORIGIN_REQUIRED');
    const input = z.union([create, reverse]).parse(await request.json().catch(() => null));
    if ('action' in input) {
      const { supabase } = await requireUser();
      const { data, error } = await supabase.rpc('reverse_personal_supplier_asset', { p_asset_id: input.asset_id });
      if (error) throw error;
      return NextResponse.json({ reversal_id: data }, { headers });
    }
    const asset = await createPersonalSupplierAsset(input.asset, input.request_id, input.terms);
    return NextResponse.json(asset, { status: 201, headers });
  } catch (error) {
    return fail(error);
  }
}

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const { asset_id, as_of } = query.parse(Object.fromEntries(params));
    if (params.getAll('asset_id').length !== 1 || params.getAll('as_of').length > 1) {
      throw Error('PERSONAL_SUPPLIER_SCHEDULE_INVALID');
    }
    const { supabase } = await requireUser();
    const { data, error } = await supabase.rpc('read_personal_supplier_schedule', {
      p_asset_id: asset_id, p_as_of: as_of ?? null,
    });
    if (error) throw error;
    return NextResponse.json({ schedule: data }, { headers });
  } catch (error) {
    return fail(error);
  }
}
