import { NextResponse } from 'next/server';
import { fxSchema } from '@/lib/validation/schemas';
import { requireUser } from '@/services/auth';
import { requireOrganizationAdmin } from '@/services/organization-access';

export async function GET(request: Request) {
  try {
    const { supabase } = await requireUser();
    const organizationId = new URL(request.url).searchParams.get('organization_id');
    if (!organizationId || !/^[0-9a-f-]{36}$/i.test(organizationId)) {
      return NextResponse.json({ error: 'ORGANIZATION_ID_REQUIRED' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('fx_rates')
      .select('*')
      .or(`organization_id.eq.${organizationId},organization_id.is.null`)
      .order('valuation_date', { ascending: false })
      .limit(300);

    if (error) throw error;
    return NextResponse.json(data ?? []);
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message },
      { status: error.message === 'UNAUTHORIZED' ? 401 : 400 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const payload = fxSchema.parse(await request.json());
    await requireOrganizationAdmin(supabase, user.id, payload.organization_id);

    const { data: currencies, error: currencyError } = await supabase
      .from('currencies')
      .select('code')
      .eq('active', true)
      .in('code', [payload.from_currency, payload.to_currency]);

    if (currencyError) throw currencyError;
    if ((currencies ?? []).length !== 2) {
      return NextResponse.json({ error: 'CURRENCY_NOT_ACTIVE' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('fx_rates')
      .upsert(payload, {
        onConflict: 'organization_id,from_currency,to_currency,valuation_date,source',
      })
      .select()
      .single();

    if (error) throw error;
    await supabase.from('audit_logs').insert({
      user_id: user.id,
      entity_type: 'fx_rate',
      entity_id: data.id,
      action: 'UPSERT',
      new_data: data,
    });

    return NextResponse.json(data, { status: 201 });
  } catch (error: any) {
    const status = error.message === 'UNAUTHORIZED' ? 401 : error.message === 'ORGANIZATION_ADMIN_REQUIRED' ? 403 : 400;
    return NextResponse.json({ error: error.message }, { status });
  }
}
