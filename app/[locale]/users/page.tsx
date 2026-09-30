'use client';

import { use, useCallback, useEffect, useMemo, useState } from 'react';

type Organization = { id: string; name: string };
type Member = { user_id: string; email: string; name: string; role: string; status: string; created_at: string; custom_role_id?: string | null; custom_role_name?: string | null };
type Invitation = { id: string; email: string; role: string; expires_at: string; accepted_at: string | null; created_at: string; custom_role_id?: string | null; custom_role_name?: string | null };
type CustomRole = { id: string; name: string; description: string; permissions: string[]; member_count: number };
const memberRoles = ['ADMIN', 'ACCOUNTANT', 'ADVISOR', 'VIEWER', 'SHARIA_REVIEWER'];
const invitationRoles = ['ACCOUNTANT', 'ADVISOR', 'VIEWER', 'SHARIA_REVIEWER'];
const permissionOptions: { key: string; ar: string; en: string }[] = [
  { key: 'liquidity.view', ar: 'عرض السيولة', en: 'View liquidity' }, { key: 'liquidity.edit', ar: 'إدارة السيولة', en: 'Manage liquidity' },
  { key: 'vat.view', ar: 'عرض ضريبة القيمة المضافة', en: 'View VAT' }, { key: 'vat.edit', ar: 'إدارة بيانات الضريبة والفواتير', en: 'Manage VAT data and invoices' }, { key: 'vat.issue', ar: 'إصدار الفواتير الإلكترونية', en: 'Issue e-invoices' },
  { key: 'organization.view', ar: 'عرض بيانات الجهة', en: 'View organization data' }, { key: 'organization.edit', ar: 'إدارة الكيانات ومراكز التكلفة', en: 'Manage entities and cost centers' },
  { key: 'zakat.view', ar: 'عرض التقييمات المجمعة', en: 'View consolidated assessments' }, { key: 'zakat.edit', ar: 'إدارة التقييمات المجمعة', en: 'Manage consolidated assessments' },
];
const labels: Record<string, [string, string]> = {
  OWNER: ['مالك', 'Owner'], ADMIN: ['مسؤول', 'Admin'], ACCOUNTANT: ['محاسب', 'Accountant'],
  ADVISOR: ['مستشار', 'Advisor'], VIEWER: ['مشاهد', 'Viewer'], SHARIA_REVIEWER: ['مراجع شرعي', 'Sharia reviewer'],
};

export default function UserManagement({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params); const ar = locale === 'ar';
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [organizationId, setOrganizationId] = useState('');
  const [members, setMembers] = useState<Member[]>([]); const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [customRoles, setCustomRoles] = useState<CustomRole[]>([]);
  const [email, setEmail] = useState(''); const [role, setRole] = useState('ACCOUNTANT');
  const [inviteUrl, setInviteUrl] = useState(''); const [inviteEmail, setInviteEmail] = useState(''); const [inviteRole, setInviteRole] = useState('ACCOUNTANT');
  const [roleName, setRoleName] = useState(''); const [roleDescription, setRoleDescription] = useState(''); const [rolePermissions, setRolePermissions] = useState<string[]>([]); const [editingRoleId, setEditingRoleId] = useState('');
  const [canShare, setCanShare] = useState(false); const [notice, setNotice] = useState('');
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
    if (!id) { setMembers([]); setInvitations([]); setCustomRoles([]); return; }
    const [response, rolesResponse] = await Promise.all([
      fetch(`/api/organizations/users?organization_id=${encodeURIComponent(id)}`, { cache: 'no-store' }),
      fetch(`/api/organizations/roles?organization_id=${encodeURIComponent(id)}`, { cache: 'no-store' }),
    ]);
    const body = await response.json().catch(() => ({}));
    const roleBody = await rolesResponse.json().catch(() => ({}));
    if (!response.ok) {
      setMembers([]); setInvitations([]); setCustomRoles([]);
      setNotice(response.status === 403 ? (ar ? 'تتطلب إدارة المستخدمين صلاحية مالك أو مسؤول في الجهة المحددة.' : 'User management requires owner or admin access to the selected organization.') : (ar ? 'تعذر تحميل المستخدمين.' : 'Could not load users.'));
      return;
    }
    setMembers(body.users ?? []); setInvitations(body.invitations ?? []); setCustomRoles(rolesResponse.ok ? roleBody.roles ?? [] : []); setNotice('');
  }, [ar]);

  useEffect(() => { void loadOrganizations(); }, [loadOrganizations]);
  useEffect(() => { void loadUsers(organizationId); }, [loadUsers, organizationId]);
  useEffect(() => { setCanShare(typeof navigator !== 'undefined' && typeof navigator.share === 'function'); }, []);

  const roleValue = (value: string, customRoleId?: string | null) => customRoleId ? `CUSTOM:${customRoleId}` : value;
  const rolePayload = (value: string) => value.startsWith('CUSTOM:') ? { role: 'CUSTOM', custom_role_id: value.slice(7) } : { role: value, custom_role_id: null };
  const roleLabel = (value: string, customRoleName?: string | null) => customRoleName || (value.startsWith('CUSTOM:') ? customRoles.find(item => item.id === value.slice(7))?.name : null) || labels[value]?.[ar ? 0 : 1] || value;
  const roleOptions = (builtins: string[]) => <>{builtins.map(value => <option key={value} value={value}>{roleLabel(value)}</option>)}{customRoles.map(item => <option key={item.id} value={`CUSTOM:${item.id}`}>{item.name}</option>)}</>;

  const inviteMessage = ar
    ? `دعوة للانضمام إلى ${organization?.name ?? 'الجهة'} في زكاة فلو\nالبريد المدعو: ${inviteEmail}\nالدور: ${roleLabel(inviteRole)}\nسجّل الدخول بالبريد نفسه لقبول الدعوة (صالحة لمدة 7 أيام): ${inviteUrl}`
    : `You are invited to join ${organization?.name ?? 'the organization'} on ZakatFlow.\nInvited email: ${inviteEmail}\nRole: ${roleLabel(inviteRole)}\nSign in using the same email to accept (valid for 7 days): ${inviteUrl}`;
  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(inviteMessage)}`;

  async function createInvite(event: React.FormEvent) {
    event.preventDefault(); if (!organizationId) return; setBusy(true); setNotice(''); setInviteUrl('');
    try {
      const response = await fetch('/api/organizations/users', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organization_id: organizationId, email, ...rolePayload(role), locale }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? 'REQUEST_FAILED');
      setInviteUrl(body.invite_url); setInviteEmail(email.trim()); setInviteRole(role); setEmail(''); setNotice(ar ? 'أنشئت الدعوة. اختر طريقة المشاركة المناسبة.' : 'Invitation created. Choose how to share it.');
      await loadUsers(organizationId);
    } catch (error) { setNotice(message(error instanceof Error ? error.message : '', ar)); }
    finally { setBusy(false); }
  }

  async function copyInviteLink() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setNotice(ar ? 'تم نسخ رابط الدعوة.' : 'Invite link copied.');
    } catch {
      setNotice(ar ? 'تعذر النسخ تلقائيًا. حدّد الرابط وانسخه يدويًا.' : 'Could not copy automatically. Select and copy the link manually.');
    }
  }

  async function shareInvite() {
    if (!navigator.share) return;
    try {
      await navigator.share({ title: ar ? 'دعوة زكاة فلو' : 'ZakatFlow invitation', text: inviteMessage, url: inviteUrl });
    } catch (error) {
      if (error instanceof Error && error.name !== 'AbortError') setNotice(ar ? 'تعذرت المشاركة من الجهاز.' : 'Device sharing failed.');
    }
  }

  async function updateMember(member: Member, nextRole: string, nextStatus: string) {
    setBusy(true); setNotice('');
    try {
      const response = await fetch('/api/organizations/users', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organization_id: organizationId, user_id: member.user_id, ...rolePayload(nextRole), status: nextStatus }) });
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

  async function saveCustomRole(event: React.FormEvent) {
    event.preventDefault(); if (!organizationId) return; setBusy(true); setNotice('');
    try {
      const response = await fetch('/api/organizations/roles', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organization_id: organizationId, id: editingRoleId || undefined, name: roleName, description: roleDescription, permissions: rolePermissions }) });
      const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(body.error ?? 'REQUEST_FAILED');
      setRoleName(''); setRoleDescription(''); setRolePermissions([]); setEditingRoleId(''); await loadUsers(organizationId);
      setNotice(ar ? 'تم حفظ الدور وصلاحياته.' : 'Role and permissions saved.');
    } catch (error) { setNotice(message(error instanceof Error ? error.message : '', ar)); }
    finally { setBusy(false); }
  }

  async function deleteCustomRole(id: string) {
    setBusy(true); setNotice('');
    try {
      const response = await fetch(`/api/organizations/roles?organization_id=${encodeURIComponent(organizationId)}&role_id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(body.error ?? 'REQUEST_FAILED');
      await loadUsers(organizationId); setNotice(ar ? 'تم حذف الدور.' : 'Role deleted.');
    } catch (error) { setNotice(message(error instanceof Error ? error.message : '', ar)); }
    finally { setBusy(false); }
  }

  return <main className="container" dir={ar ? 'rtl' : 'ltr'} style={{ maxWidth: 1180, paddingTop: 30, paddingBottom: 60 }}>
    <header style={{ marginBottom: 24 }}><span className="pill">{ar ? 'إدارة الوصول' : 'ACCESS MANAGEMENT'}</span><h1>{ar ? 'المستخدمون والصلاحيات' : 'Users & permissions'}</h1><p className="muted">{ar ? 'اربط حسابات الدخول بالجهات، وأدر أدوار الأعضاء والدعوات.' : 'Link sign-in accounts to organizations, and manage member roles and invitations.'}</p></header>
    {notice && <div className="card" role="status" style={{ marginBottom: 16 }}>{notice}</div>}
    <section className="card" style={{ marginBottom: 20 }}>
      <label style={{ display: 'grid', gap: 8, maxWidth: 540 }}><strong>{ar ? 'الجهة' : 'Organization'}</strong><select value={organizationId} onChange={event => { setOrganizationId(event.target.value); setInviteUrl(''); setInviteEmail(''); }} disabled={loading || !organizations.length} style={{ padding: 12 }}>
        {organizations.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      {!loading && !organizations.length && <p className="muted">{ar ? 'لا توجد جهات متاحة في حسابك.' : 'No organizations are available in your account.'}</p>}
    </section>
    {organization && <>
      <section className="card" style={{ marginBottom: 20 }}><h2>{ar ? 'الأدوار المخصصة' : 'Custom roles'}</h2><p className="muted">{ar ? 'أنشئ دورًا وحدد صلاحياته على وحدات الجهة. إدارة المستخدمين والأدوار تبقى للمالك والمسؤول.' : 'Create a role and choose its permissions for organization modules. User and role administration stays with owners and admins.'}</p>
        <form onSubmit={saveCustomRole} style={{ display: 'grid', gap: 12, marginBottom: 18 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 10 }}>
            <label style={{ display: 'grid', gap: 6 }}><span>{ar ? 'اسم الدور' : 'Role name'}</span><input required minLength={2} maxLength={60} value={roleName} onChange={event => setRoleName(event.target.value)} style={{ padding: 10 }} /></label>
            <label style={{ display: 'grid', gap: 6 }}><span>{ar ? 'الوصف' : 'Description'}</span><input maxLength={240} value={roleDescription} onChange={event => setRoleDescription(event.target.value)} style={{ padding: 10 }} /></label>
          </div>
          <strong>{ar ? 'الصلاحيات' : 'Permissions'}</strong>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 8 }}>
            {permissionOptions.map(item => <label key={item.key} style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={rolePermissions.includes(item.key)} onChange={event => setRolePermissions(current => event.target.checked ? [...current, item.key] : current.filter(key => key !== item.key))} />{ar ? item.ar : item.en}</label>)}
          </div>
          <div style={{ display: 'flex', gap: 8 }}><button className="btn" type="submit" disabled={busy}>{editingRoleId ? (ar ? 'حفظ التعديلات' : 'Save changes') : (ar ? 'إنشاء الدور' : 'Create role')}</button>{editingRoleId && <button className="btn secondary" type="button" onClick={() => { setEditingRoleId(''); setRoleName(''); setRoleDescription(''); setRolePermissions([]); }}>{ar ? 'إلغاء' : 'Cancel'}</button>}</div>
        </form>
        {customRoles.length ? <div style={{ display: 'grid', gap: 8 }}>{customRoles.map(item => <div key={item.id} style={{ borderTop: '1px solid var(--border)', paddingTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}><div><strong>{item.name}</strong><div className="muted">{item.description || (ar ? 'بلا وصف' : 'No description')} · {item.permissions.length} {ar ? 'صلاحية' : 'permissions'} · {item.member_count} {ar ? 'عضو' : 'members'}</div></div><div style={{ display: 'flex', gap: 8 }}><button className="btn secondary" type="button" disabled={busy} onClick={() => { setEditingRoleId(item.id); setRoleName(item.name); setRoleDescription(item.description); setRolePermissions(item.permissions); }}>{ar ? 'تعديل' : 'Edit'}</button><button className="btn secondary" type="button" disabled={busy} onClick={() => void deleteCustomRole(item.id)}>{ar ? 'حذف' : 'Delete'}</button></div></div>)}</div> : <p className="muted">{ar ? 'لم تُنشأ أدوار مخصصة بعد.' : 'No custom roles yet.'}</p>}
      </section>
      <section className="card" style={{ marginBottom: 20 }}><h2>{ar ? 'دعوة مستخدم' : 'Invite a user'}</h2><p className="muted">{ar ? 'يُنشأ رابط دعوة صالح لمدة سبعة أيام. على المدعو تسجيل الدخول بالبريد نفسه لقبولها.' : 'The invite link is valid for seven days. The invitee must sign in with the same email to accept it.'}</p>
        <form onSubmit={createInvite} style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 2fr) minmax(150px, 1fr) auto', gap: 10, alignItems: 'end' }}>
          <label style={{ display: 'grid', gap: 6 }}><span>{ar ? 'البريد الإلكتروني' : 'Email'}</span><input type="email" required value={email} onChange={event => setEmail(event.target.value)} placeholder="user@example.com" style={{ padding: 11 }} /></label>
          <label style={{ display: 'grid', gap: 6 }}><span>{ar ? 'الدور' : 'Role'}</span><select value={role} onChange={event => setRole(event.target.value)} style={{ padding: 11 }}>{roleOptions(invitationRoles)}</select></label>
          <button className="btn" type="submit" disabled={busy}>{ar ? 'إنشاء الدعوة' : 'Create invite'}</button>
        </form>
        {inviteUrl && <><div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
          <a className="btn" href={whatsappUrl} target="_blank" rel="noopener noreferrer" style={{ background: '#25D366', color: '#102116' }}>{ar ? 'مشاركة عبر واتساب' : 'Share via WhatsApp'}</a>
          {canShare && <button className="btn secondary" type="button" onClick={() => void shareInvite()}>{ar ? 'مشاركة…' : 'Share…'}</button>}
          <button className="btn secondary" type="button" onClick={() => void copyInviteLink()}>{ar ? 'نسخ الرابط' : 'Copy link'}</button>
        </div><input readOnly value={inviteUrl} aria-label={ar ? 'رابط الدعوة' : 'Invite link'} style={{ width: '100%', marginTop: 10, padding: 10 }} /></>}
      </section>
      <section className="card" style={{ marginBottom: 20, overflowX: 'auto' }}><h2>{ar ? 'أعضاء الجهة' : 'Organization members'}</h2>
        <table className="table"><thead><tr><th>{ar ? 'المستخدم' : 'User'}</th><th>{ar ? 'الدور' : 'Role'}</th><th>{ar ? 'الحالة' : 'Status'}</th><th>{ar ? 'إجراءات' : 'Actions'}</th></tr></thead><tbody>
          {members.map(member => <tr key={member.user_id}><td><strong>{member.name || member.email}</strong><br /><small className="muted">{member.email}</small></td><td>{member.role === 'OWNER' ? roleLabel(member.role) : <select value={roleValue(member.role, member.custom_role_id)} disabled={busy} onChange={event => void updateMember(member, event.target.value, member.status)}>{roleOptions(memberRoles)}</select>}</td><td>{member.status === 'ACTIVE' ? (ar ? 'نشط' : 'Active') : (ar ? 'موقوف' : 'Inactive')}</td><td>{member.role !== 'OWNER' && <button className="btn secondary" type="button" disabled={busy} onClick={() => void updateMember(member, roleValue(member.role, member.custom_role_id), member.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE')}>{member.status === 'ACTIVE' ? (ar ? 'إيقاف' : 'Suspend') : (ar ? 'إعادة تفعيل' : 'Reactivate')}</button>}</td></tr>)}
          {!members.length && <tr><td colSpan={4} className="muted">{ar ? 'لا توجد عضويات، أو لا تملك صلاحية الإدارة.' : 'No members found, or you do not have management access.'}</td></tr>}
        </tbody></table>
      </section>
      <section className="card" style={{ overflowX: 'auto' }}><h2>{ar ? 'الدعوات' : 'Invitations'}</h2><table className="table"><thead><tr><th>{ar ? 'البريد' : 'Email'}</th><th>{ar ? 'الدور' : 'Role'}</th><th>{ar ? 'الحالة' : 'Status'}</th><th>{ar ? 'الإجراء' : 'Action'}</th></tr></thead><tbody>
        {invitations.map(invitation => { const accepted = !!invitation.accepted_at; const expired = new Date(invitation.expires_at) <= new Date(); return <tr key={invitation.id}><td>{invitation.email}</td><td>{roleLabel(invitation.role, invitation.custom_role_name)}</td><td>{accepted ? (ar ? 'مقبولة' : 'Accepted') : expired ? (ar ? 'منتهية' : 'Expired') : (ar ? 'بانتظار القبول' : 'Pending')}</td><td>{!accepted && <button className="btn secondary" type="button" disabled={busy} onClick={() => void revokeInvite(invitation.id)}>{ar ? 'إلغاء' : 'Revoke'}</button>}</td></tr>; })}
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
