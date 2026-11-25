import { NextResponse } from 'next/server';
import { z } from 'zod';
import { fxSchema } from '../../../lib/validation/schemas';
import { isSameOriginRequest } from '../../../lib/request-origin';
import { requireUser } from '../../../services/auth';
import { requireOrganizationAdmin } from '../../../services/organization-access';

const headers = { 'Cache-Control': 'private, no-store' };
const rateColumns = 'id,from_currency,to_currency,rate,valuation_date,source';

export async function GET(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const params = new URL(request.url).searchParams;
    const scope = params.get('scope') ?? 'ORGANIZATION';
    const organizationId = params.get('organization_id');
    if (scope === 'PERSONAL' && !organizationId) {
      const [personal, reference] = await Promise.all([
        supabase.from('personal_fx_rates').select(rateColumns).eq('user_id', user.id)
          .order('valuation_date', { ascending: false }).order('id', { ascending: false }).limit(300),
        supabase.from('fx_rates').select(rateColumns).is('organization_id', null)
          .order('valuation_date', { ascending: false }).order('id', { ascending: false }).limit(300),
      ]);
      if (personal.error || reference.error) throw personal.error || reference.error;
      return NextResponse.json([
        ...personal.data.map((row) => ({ ...row, organization_id: null, scope: 'PERSONAL' })),
        ...reference.data.map((row) => ({ ...row, organization_id: null, scope: 'GLOBAL' })),
      ], { headers });
    }
    if (scope !== 'ORGANIZATION') throw Error('FX_SCOPE_INVALID');
    if (!z.string().uuid().safeParse(organizationId).success) throw Error('ORGANIZATION_ID_REQUIRED');

    const { data, error } = await supabase.from('fx_rates').select('*')
      .or(`organization_id.eq.${organizationId},organization_id.is.null`)
      .order('valuation_date', { ascending: false }).limit(300);

    if (error) throw error;
    return NextResponse.json(data ?? [], { headers });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const { scope, organization_id, ...rate } = fxSchema.parse(await request.json());
    if (scope === 'PERSONAL') {
      if (organization_id) throw Error('FX_SCOPE_INVALID');
      if (!isSameOriginRequest(request)) throw Error('ORIGIN_REQUIRED');
    } else {
      if (!organization_id) throw Error('ORGANIZATION_ID_REQUIRED');
      await requireOrganizationAdmin(supabase, user.id, organization_id);
    }

    const { data: currencies, error: currencyError } = await supabase.from('currencies')
      .select('code').eq('active', true).in('code', [rate.from_currency, rate.to_currency]);
    if (currencyError) throw currencyError;
    if ((currencies ?? []).length !== 2) throw Error('CURRENCY_NOT_ACTIVE');

    const key = 'from_currency,to_currency,valuation_date,source';
    const { data, error } = scope === 'PERSONAL'
      ? await supabase.from('personal_fx_rates').upsert({ ...rate, user_id: user.id }, {
        onConflict: `user_id,${key}`,
      }).select(rateColumns).single()
      : await supabase.from('fx_rates').upsert({ ...rate, organization_id }, {
        onConflict: `organization_id,${key}`,
      }).select().single();

    if (error) throw error;
    await supabase.from('audit_logs').insert({
      user_id: user.id,
      entity_type: 'fx_rate',
      entity_id: data.id,
      action: 'UPSERT',
      new_data: data,
    });

    return NextResponse.json(data, { status: 201, headers });
  } catch (error) {
    return failure(error);
  }
}

function failure(error: unknown) {
  const message = (error as { message?: string })?.message ?? 'FX_REQUEST_FAILED';
  const status = message === 'UNAUTHORIZED' ? 401 :
    ['ORGANIZATION_ACCESS_REQUIRED', 'ORGANIZATION_ADMIN_REQUIRED', 'ORIGIN_REQUIRED'].includes(message) ? 403 : 400;
  return NextResponse.json({ error: message }, { status, headers });
}
