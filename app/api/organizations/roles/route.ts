import { NextResponse } from 'next/server';
import { requireUser } from '@/services/auth';

const errorStatus = (message: string) =>
  message === 'UNAUTHORIZED' ? 401 :
  message.includes('ADMIN_REQUIRED') ? 403 :
  message === 'ROLE_IN_USE' ? 409 : 400;

export async function GET(request: Request) {
  try {
    const organizationId = new URL(request.url).searchParams.get('organization_id');
    if (!organizationId) return NextResponse.json({ error: 'ORGANIZATION_REQUIRED' }, { status: 400 });
    const { supabase } = await requireUser();
    const { data, error } = await supabase.rpc('list_organization_roles', { p_organization_id: organizationId });
    if (error) throw error;
    return NextResponse.json({ roles: data ?? [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'REQUEST_FAILED';
    return NextResponse.json({ error: message }, { status: errorStatus(message) });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const organizationId = String(body.organization_id ?? '');
    const name = String(body.name ?? '').trim();
    const description = String(body.description ?? '').trim();
    const permissions = Array.isArray(body.permissions) ? body.permissions.filter((value: unknown): value is string => typeof value === 'string') : [];
    if (!organizationId || name.length < 2 || name.length > 60 || description.length > 240) {
      return NextResponse.json({ error: 'ROLE_DETAILS_INVALID' }, { status: 400 });
    }
    const { supabase } = await requireUser();
    const { data, error } = await supabase.rpc('save_organization_role', {
      p_organization_id: organizationId,
      p_role_id: typeof body.id === 'string' ? body.id : null,
      p_name: name,
      p_description: description,
      p_permissions: permissions,
    });
    if (error) throw error;
    return NextResponse.json({ role: data?.[0] ?? null });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'REQUEST_FAILED';
    return NextResponse.json({ error: message }, { status: errorStatus(message) });
  }
}

export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url);
    const organizationId = url.searchParams.get('organization_id');
    const roleId = url.searchParams.get('role_id');
    if (!organizationId || !roleId) return NextResponse.json({ error: 'ROLE_REQUIRED' }, { status: 400 });
    const { supabase } = await requireUser();
    const { error } = await supabase.rpc('delete_organization_role', { p_organization_id: organizationId, p_role_id: roleId });
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'REQUEST_FAILED';
    return NextResponse.json({ error: message }, { status: errorStatus(message) });
  }
}
