import { NextResponse } from 'next/server';
import { requireUser } from '@/services/auth';

const roles = new Set(['ACCOUNTANT', 'ADVISOR', 'VIEWER', 'SHARIA_REVIEWER']);
const errorStatus = (message: string) =>
  message === 'UNAUTHORIZED' ? 401 :
  message.includes('ADMIN_REQUIRED') || message === 'ROLE_FORBIDDEN' ? 403 :
  message === 'USER_ALREADY_MEMBER' ? 409 : 400;

export async function GET(request: Request) {
  try {
    const organizationId = new URL(request.url).searchParams.get('organization_id');
    if (!organizationId) return NextResponse.json({ error: 'ORGANIZATION_REQUIRED' }, { status: 400 });
    const { supabase } = await requireUser();
    const [{ data: users, error: usersError }, { data: invitations, error: invitationsError }] = await Promise.all([
      supabase.rpc('list_organization_users', { p_organization_id: organizationId }),
      supabase.rpc('list_organization_invitations', { p_organization_id: organizationId }),
    ]);
    if (usersError) throw usersError;
    if (invitationsError) throw invitationsError;
    return NextResponse.json({ users: users ?? [], invitations: invitations ?? [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'REQUEST_FAILED';
    return NextResponse.json({ error: message }, { status: errorStatus(message) });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const organizationId = String(body.organization_id ?? '');
    const email = String(body.email ?? '').trim().toLowerCase();
    const role = String(body.role ?? '');
    const customRoleId = typeof body.custom_role_id === 'string' ? body.custom_role_id : null;
    const locale = body.locale === 'en' ? 'en' : 'ar';
    if (!organizationId || !email || (!roles.has(role) && !(role === 'CUSTOM' && customRoleId))) {
      return NextResponse.json({ error: 'INVITATION_DETAILS_INVALID' }, { status: 400 });
    }
    const { supabase } = await requireUser();
    const { data, error } = await supabase.rpc('create_organization_invitation', {
      p_organization_id: organizationId,
      p_email: email,
      p_role: role,
      p_custom_role_id: customRoleId,
    });
    if (error) throw error;
    const invitation = data?.[0];
    if (!invitation) throw new Error('INVITATION_CREATE_FAILED');
    const origin = new URL(request.url).origin;
    return NextResponse.json({
      ...invitation,
      invite_url: `${origin}/${locale}/login?invite=${encodeURIComponent(invitation.token)}`,
    }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'REQUEST_FAILED';
    return NextResponse.json({ error: message }, { status: errorStatus(message) });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { organization_id: organizationId, user_id: userId, role, status } = body;
    const customRoleId = typeof body.custom_role_id === 'string' ? body.custom_role_id : null;
    if (!organizationId || !userId || (!['OWNER','ADMIN','ACCOUNTANT','ADVISOR','VIEWER','SHARIA_REVIEWER'].includes(role) && !(role === 'CUSTOM' && customRoleId)) || !['ACTIVE','INACTIVE'].includes(status)) {
      return NextResponse.json({ error: 'MEMBER_DETAILS_INVALID' }, { status: 400 });
    }
    const { supabase } = await requireUser();
    const { error } = await supabase.rpc('manage_organization_member', {
      p_organization_id: organizationId,
      p_user_id: userId,
      p_role: role,
      p_status: status,
      p_custom_role_id: customRoleId,
    });
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'REQUEST_FAILED';
    return NextResponse.json({ error: message }, { status: errorStatus(message) });
  }
}

export async function DELETE(request: Request) {
  try {
    const invitationId = new URL(request.url).searchParams.get('invitation_id');
    if (!invitationId) return NextResponse.json({ error: 'INVITATION_REQUIRED' }, { status: 400 });
    const { supabase } = await requireUser();
    const { error } = await supabase.rpc('revoke_organization_invitation', { p_invitation_id: invitationId });
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'REQUEST_FAILED';
    return NextResponse.json({ error: message }, { status: errorStatus(message) });
  }
}
