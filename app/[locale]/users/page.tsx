'use client';

import { use, useCallback, useEffect, useMemo, useState } from 'react';

type Organization = { id: string; name: string };
type Member = { user_id: string; email: string; name: string; role: string; status: string; created_at: string };
type Invitation = { id: string; email: string; role: string; expires_at: string; accepted_at: string | null; created_at: string };
const memberRoles = ['ADMIN', 'ACCOUNTANT', 'ADVISOR', 'VIEWER', 'SHARIA_REVIEWER'];
const invitationRoles = ['ACCOUNTANT', 'ADVISOR', 'VIEWER', 'SHARIA_REVIEWER'];
const labels: Record<string, [string, string]> = {
  OWNER: ['مالك', 'Owner'], ADMIN: ['مسؤول', 'Admin'], ACCOUNTANT: ['محاسب', 'Accountant'],
  ADVISOR: ['مستشار', 'Advisor'], VIEWER: ['مشاهد', 'Viewer'], SHARIA_REVIEWER: ['مراجع شرعي', 'Sharia reviewer'],
};

export default function UserManagement({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params); const ar = locale === 'ar';
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [organizationId, setOrganizationId] = useState('');
  const [members, setMembers] = useState<Member[]>([]); const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [email, setEmail] = useState(''); const [role, setRole] = useState('ACCOUNTANT');
  const [inviteUrl, setInviteUrl] = useState(''); const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false);
  const organization = useMemo(() => organizations.find(item => item.id === organizationId), [organizations, organizationId]);

  const loadOrganizations = useCallback(async () => {
    try {
      const response = await fetch('/api/organizations', { cache: 'no-store' });
      if (!response.ok) throw new Error();
      const rows = await response.json() as Organization[];
      setOrganizations(rows);
      setOrganizationId(current => rows.some(item => item.id === current) ? current : rows[0]?.id ?? '');
    } catch { setNotice(ar ? 'تعذر تحميل الجهات.' : 'Could not load organizations.'); }
    finally { setLoading(false); }
  }, [ar]);

  const loadUsers = useCallback(async (id: string) => {
    if (!id) { setMembers([]); setInvitations([]); return; }
    const response = await fetch(`/api/organizations/users?organization_id=${encodeURIComponent(id)}`, { cache: 'no-store' });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMembers([]); setInvitations([]);
      setNotice(response.status === 403 ? (ar ? 'تتطلب إدارة المستخدمين صلاحية مالك أو مسؤول في الجهة المحددة.' : 'User management requires owner or admin access to the selected organization.') : (ar ? 'تعذر تحميل المستخدمين.' : 'Could not load users.'));
      return;
    }
    setMembers(body.users ?? []); setInvitations(body.invitations ?? []); setNotice('');
  }, [ar]);

  useEffect(() => { void loadOrganizations(); }, [loadOrganizations]);
  useEffect(() => { void loadUsers(organizationId); }, [loadUsers, organizationId]);

  async function createInvite(event: React.FormEvent) {
    event.preventDefault(); if (!organizationId) return; setBusy(true); setNotice(''); setInviteUrl('');
    try {
      const response = await fetch('/api/organizations/users', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organization_id: organizationId, email, role, locale }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? 'REQUEST_FAILED');
      setInviteUrl(body.invite_url); setEmail(''); setNotice(ar ? 'أنشئت الدعوة. انسخ الرابط وأرسله للمدعو.' : 'Invitation created. Copy the link and send it to the invitee.');
      await loadUsers(organizationId);
    } catch (error) { setNotice(message(error instanceof Error ? error.message : '', ar)); }
    finally { setBusy(false); }
  }

  async function updateMember(member: Member, nextRole: string, nextStatus: string) {
    setBusy(true); setNotice('');
    try {
      const response = await fetch('/api/organizations/users', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organization_id: organizationId, user_id: member.user_id, role: nextRole, status: nextStatus }) });
      const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(body.error ?? 'REQUEST_FAILED');
      await loadUsers(organizationId); setNotice(ar ? 'تم تحديث صلاحيات المستخدم.' : 'User access updated.');
    } catch (error) { setNotice(message(error instanceof Error ? error.message : '', ar)); }
    finally { setBusy(false); }
  }

  async function revokeInvite(id: string) {
    setBusy(true);
    try {
      const response = await fetch(`/api/organizations/users?invitation_id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(body.error ?? 'REQUEST_FAILED');
      await loadUsers(organizationId); setNotice(ar ? 'ألغيت الدعوة.' : 'Invitation revoked.');
    } catch (error) { setNotice(message(error instanceof Error ? error.message : '', ar)); }
    finally { setBusy(false); }
  }

  const roleLabel = (value: string) => labels[value]?.[ar ? 0 : 1] ?? value;
  return <main className="container" dir={ar ? 'rtl' : 'ltr'} style={{ maxWidth: 1180, paddingTop: 30, paddingBottom: 60 }}>
    <header style={{ marginBottom: 24 }}><span className="pill">{ar ? 'إدارة الوصول' : 'ACCESS MANAGEMENT'}</span><h1>{ar ? 'المستخدمون والصلاحيات' : 'Users & permissions'}</h1><p className="muted">{ar ? 'اربط حسابات الدخول بالجهات، وأدر أدوار الأعضاء والدعوات.' : 'Link sign-in accounts to organizations, and manage member roles and invitations.'}</p></header>
    {notice && <div className="card" role="status" style={{ marginBottom: 16 }}>{notice}</div>}
    <section className="card" style={{ marginBottom: 20 }}>
      <label style={{ display: 'grid', gap: 8, maxWidth: 540 }}><strong>{ar ? 'الجهة' : 'Organization'}</strong><select value={organizationId} onChange={event => { setOrganizationId(event.target.value); setInviteUrl(''); }} disabled={loading || !organizations.length} style={{ padding: 12 }}>
        {organizations.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      {!loading && !organizations.length && <p className="muted">{ar ? 'لا توجد جهات متاحة في حسابك.' : 'No organizations are available in your account.'}</p>}
    </section>
    {organization && <>
      <section className="card" style={{ marginBottom: 20 }}><h2>{ar ? 'دعوة مستخدم' : 'Invite a user'}</h2><p className="muted">{ar ? 'يُنشأ رابط دعوة صالح لمدة سبعة أيام. على المدعو تسجيل الدخول بالبريد نفسه لقبولها.' : 'The invite link is valid for seven days. The invitee must sign in with the same email to accept it.'}</p>
        <form onSubmit={createInvite} style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 2fr) minmax(150px, 1fr) auto', gap: 10, alignItems: 'end' }}>
          <label style={{ display: 'grid', gap: 6 }}><span>{ar ? 'البريد الإلكتروني' : 'Email'}</span><input type="email" required value={email} onChange={event => setEmail(event.target.value)} placeholder="user@example.com" style={{ padding: 11 }} /></label>
          <label style={{ display: 'grid', gap: 6 }}><span>{ar ? 'الدور' : 'Role'}</span><select value={role} onChange={event => setRole(event.target.value)} style={{ padding: 11 }}>{invitationRoles.map(value => <option key={value} value={value}>{roleLabel(value)}</option>)}</select></label>
          <button className="btn" type="submit" disabled={busy}>{ar ? 'إنشاء الدعوة' : 'Create invite'}</button>
        </form>
        {inviteUrl && <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}><input readOnly value={inviteUrl} aria-label={ar ? 'رابط الدعوة' : 'Invite link'} style={{ flex: 1, minWidth: 240, padding: 10 }} /><button className="btn secondary" type="button" onClick={() => void navigator.clipboard.writeText(inviteUrl).then(() => setNotice(ar ? 'تم نسخ رابط الدعوة.' : 'Invite link copied.'))}>{ar ? 'نسخ الرابط' : 'Copy link'}</button></div>}
      </section>
      <section className="card" style={{ marginBottom: 20, overflowX: 'auto' }}><h2>{ar ? 'أعضاء الجهة' : 'Organization members'}</h2>
        <table className="table"><thead><tr><th>{ar ? 'المستخدم' : 'User'}</th><th>{ar ? 'الدور' : 'Role'}</th><th>{ar ? 'الحالة' : 'Status'}</th><th>{ar ? 'إجراءات' : 'Actions'}</th></tr></thead><tbody>
          {members.map(member => <tr key={member.user_id}><td><strong>{member.name || member.email}</strong><br /><small className="muted">{member.email}</small></td><td>{member.role === 'OWNER' ? roleLabel(member.role) : <select value={member.role} disabled={busy} onChange={event => void updateMember(member, event.target.value, member.status)}>{memberRoles.map(value => <option key={value} value={value}>{roleLabel(value)}</option>)}</select>}</td><td>{member.status === 'ACTIVE' ? (ar ? 'نشط' : 'Active') : (ar ? 'موقوف' : 'Inactive')}</td><td>{member.role !== 'OWNER' && <button className="btn secondary" type="button" disabled={busy} onClick={() => void updateMember(member, member.role, member.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE')}>{member.status === 'ACTIVE' ? (ar ? 'إيقاف' : 'Suspend') : (ar ? 'إعادة تفعيل' : 'Reactivate')}</button>}</td></tr>)}
          {!members.length && <tr><td colSpan={4} className="muted">{ar ? 'لا توجد عضويات، أو لا تملك صلاحية الإدارة.' : 'No members found, or you do not have management access.'}</td></tr>}
        </tbody></table>
      </section>
      <section className="card" style={{ overflowX: 'auto' }}><h2>{ar ? 'الدعوات' : 'Invitations'}</h2><table className="table"><thead><tr><th>{ar ? 'البريد' : 'Email'}</th><th>{ar ? 'الدور' : 'Role'}</th><th>{ar ? 'الحالة' : 'Status'}</th><th>{ar ? 'الإجراء' : 'Action'}</th></tr></thead><tbody>
        {invitations.map(invitation => { const accepted = !!invitation.accepted_at; const expired = new Date(invitation.expires_at) <= new Date(); return <tr key={invitation.id}><td>{invitation.email}</td><td>{roleLabel(invitation.role)}</td><td>{accepted ? (ar ? 'مقبولة' : 'Accepted') : expired ? (ar ? 'منتهية' : 'Expired') : (ar ? 'بانتظار القبول' : 'Pending')}</td><td>{!accepted && <button className="btn secondary" type="button" disabled={busy} onClick={() => void revokeInvite(invitation.id)}>{ar ? 'إلغاء' : 'Revoke'}</button>}</td></tr>; })}
        {!invitations.length && <tr><td colSpan={4} className="muted">{ar ? 'لا توجد دعوات.' : 'No invitations.'}</td></tr>}
      </tbody></table></section>
    </>}
  </main>;
}

function message(code: string, ar: boolean) {
  const map: Record<string, [string, string]> = {
    ORGANIZATION_ADMIN_REQUIRED: ['تتطلب هذه العملية صلاحية مالك أو مسؤول.', 'This action requires owner or admin access.'],
    ROLE_FORBIDDEN: ['لا تملك صلاحية منح هذا الدور أو تغييره.', 'You cannot grant or change this role.'],
    EMAIL_INVALID: ['البريد الإلكتروني غير صحيح.', 'The email address is invalid.'],
    ROLE_INVALID: ['الدور المحدد غير صالح.', 'The selected role is invalid.'],
    USER_ALREADY_MEMBER: ['هذا المستخدم عضو بالفعل في الجهة.', 'This user is already a member of this organization.'],
    INVITATION_EMAIL_MISMATCH: ['يجب قبول الدعوة باستخدام البريد المدعو نفسه.', 'The invitation must be accepted with the invited email.'],
    INVITATION_INVALID_OR_EXPIRED: ['الدعوة غير صالحة أو منتهية.', 'The invitation is invalid or expired.'],
    LAST_OWNER_REQUIRED: ['يجب أن يبقى مالك نشط واحد على الأقل.', 'At least one active owner must remain.'],
    CANNOT_CHANGE_OWN_ACCESS: ['لا يمكنك تغيير صلاحيات حسابك بنفسك.', 'You cannot change your own access.'],
  };
  return map[code]?.[ar ? 0 : 1] ?? (ar ? 'تعذر تنفيذ الطلب. أعد المحاولة.' : 'Could not complete the request. Please try again.');
}
