import { NextResponse } from 'next/server';
import { currencySchema } from '@/lib/validation/schemas';
import { requireUser } from '@/services/auth';
import { requireOrganizationAdmin } from '@/services/organization-access';

export async function GET() {
  try {
    const { supabase } = await requireUser();
    const { data, error } = await supabase
      .from('currencies')
      .select('code,name_ar,name_en,symbol,decimals,active')
      .eq('active', true)
      .order('code', { ascending: true });

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
    const payload = currencySchema.parse(await request.json());
    await requireOrganizationAdmin(supabase, user.id, payload.organization_id);

    const { data, error } = await supabase
      .from('currencies')
      .insert({
        code: payload.code,
        name_ar: payload.name_ar,
        name_en: payload.name_en,
        symbol: payload.symbol || null,
        decimals: payload.decimals,
        active: true,
        created_by: user.id,
      })
      .select('code,name_ar,name_en,symbol,decimals,active')
      .single();

    if (error?.code === '23505') {
      return NextResponse.json({ error: 'CURRENCY_CODE_ALREADY_EXISTS' }, { status: 409 });
    }
    if (error) throw error;

    await supabase.from('audit_logs').insert({
      user_id: user.id,
      entity_type: 'currency',
      action: 'CREATE',
      new_data: data,
    });

    return NextResponse.json(data, { status: 201 });
  } catch (error: any) {
    const status = error.message === 'UNAUTHORIZED' ? 401 : error.message === 'ORGANIZATION_ADMIN_REQUIRED' ? 403 : 400;
    return NextResponse.json({ error: error.message }, { status });
  }
}
