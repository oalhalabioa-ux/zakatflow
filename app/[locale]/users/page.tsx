'use client';

import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styles from './users.module.css';

type Organization = { id: string; name: string };
type Member = { user_id: string; email: string; name: string; role: string; status: string; created_at: string; custom_role_id?: string | null; custom_role_name?: string | null };
type Invitation = { id: string; email: string; role: string; expires_at: string; accepted_at: string | null; created_at: string; custom_role_id?: string | null; custom_role_name?: string | null };
type CustomRole = { id: string; name: string; description: string; permissions: string[]; member_count: number; role_key?: string | null; is_system_template?: boolean; is_editable?: boolean; amount_limits?: Record<string, number> };
type PermissionOverride = { user_id:string; permission:string; effect:'ALLOW'|'DENY'; amount_limit:number|null; currency:string|null };
const memberRoles = ['ADMIN', 'ACCOUNTANT', 'ADVISOR', 'VIEWER', 'SHARIA_REVIEWER'];
const invitationRoles = ['ACCOUNTANT', 'ADVISOR', 'VIEWER', 'SHARIA_REVIEWER'];
import {permissionGroups, permissionOptions, rolePresets, moduleCoverage, toggleRolePermission} from '@/lib/role-permission-catalog';
import {SENSITIVE_PERMISSIONS} from '@/lib/organization-permissions';
const labels: Record<string, [string, string]> = {
  OWNER: ['مالك', 'Owner'], ADMIN: ['مسؤول', 'Admin'], ACCOUNTANT: ['محاسب', 'Accountant'],
  ADVISOR: ['مستشار', 'Advisor'], VIEWER: ['مشاهد', 'Viewer'], SHARIA_REVIEWER: ['مراجع شرعي', 'Sharia reviewer'],
};

export default function UserManagement({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params); const ar = locale === 'ar';
  const [activeTab,setActiveTab]=useState('roles');
  const [permissionSearch,setPermissionSearch]=useState('');
  const [overrideUser,setOverrideUser]=useState('');
  const [roleSearch,setRoleSearch]=useState('');
  const [presetId,setPresetId]=useState('');
  const [actorRole,setActorRole]=useState('');
  const [actorId,setActorId]=useState('');
  const [dataLoading,setDataLoading]=useState(false);
  const requestVersion=useRef(0);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [organizationId, setOrganizationId] = useState('');
  const [members, setMembers] = useState<Member[]>([]); const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [customRoles, setCustomRoles] = useState<CustomRole[]>([]);
  const [approvalPolicy,setApprovalPolicy]=useState('OWNER_CONTROLLED'); const [permissionOverrides,setPermissionOverrides]=useState<PermissionOverride[]>([]); const [governanceReady,setGovernanceReady]=useState(false);
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
    const version=++requestVersion.current;
    setDataLoading(true);setGovernanceReady(false);setActorRole('');setActorId('');
    try {
    if (!id) { setMembers([]); setInvitations([]); setCustomRoles([]); return; }
    const [response, rolesResponse, governanceResponse] = await Promise.all([
      fetch(`/api/organizations/users?organization_id=${encodeURIComponent(id)}`, { cache: 'no-store' }),
      fetch(`/api/organizations/roles?organization_id=${encodeURIComponent(id)}`, { cache: 'no-store' }),
      fetch(`/api/organizations/permissions?organization_id=${encodeURIComponent(id)}`, { cache: 'no-store' }),
    ]);
    if(version!==requestVersion.current)return;
    const body = await response.json().catch(() => ({}));
    const roleBody = await rolesResponse.json().catch(() => ({}));
    const governanceBody = await governanceResponse.json().catch(() => ({}));
    if(version!==requestVersion.current)return;
    if (!response.ok) {
      setMembers([]); setInvitations([]); setCustomRoles([]);
      setNotice(response.status === 403 ? (ar ? 'تتطلب إدارة المستخدمين صلاحية مالك أو مسؤول في الجهة المحددة.' : 'User management requires owner or admin access to the selected organization.') : (ar ? 'تعذر تحميل المستخدمين.' : 'Could not load users.'));
      return;
    }
    setActorRole(body.actor_role??'');setActorId(body.actor_user_id??'');setMembers(body.users ?? []); setInvitations(body.invitations ?? []);
    const governedRoles=governanceResponse.ok ? governanceBody.roles ?? [] : [];
    setCustomRoles(governedRoles.length ? governedRoles.map((r:CustomRole)=>({...r,member_count:(roleBody.roles??[]).find((x:CustomRole)=>x.id===r.id)?.member_count??0})) : (rolesResponse.ok ? roleBody.roles ?? [] : []));
    setApprovalPolicy(governanceBody.approval_policy ?? 'OWNER_CONTROLLED'); setPermissionOverrides(governanceBody.overrides ?? []); setGovernanceReady(governanceResponse.ok); setNotice(!rolesResponse.ok || !governanceResponse.ok ? (ar?'تعذر تحميل بعض بيانات الصلاحيات. أعد التحميل قبل التعديل.':'Some permission data could not load. Reload before editing.'):'');
    }catch{if(version===requestVersion.current){setMembers([]);setInvitations([]);setCustomRoles([]);setNotice(ar?'تعذر تحميل بيانات الوصول. أعد المحاولة.':'Could not load access data. Please retry.');}}finally{if(version===requestVersion.current)setDataLoading(false);}
  }, [ar]);

  useEffect(() => { void loadOrganizations(); }, [loadOrganizations]);
  useEffect(() => { void loadUsers(organizationId); }, [loadUsers, organizationId]);
  useEffect(() => { setCanShare(typeof navigator !== 'undefined' && typeof navigator.share === 'function'); }, []);

  const roleValue = (value: string, customRoleId?: string | null) => customRoleId ? `CUSTOM:${customRoleId}` : value;
  const rolePayload = (value: string) => value.startsWith('CUSTOM:') ? { role: 'CUSTOM', custom_role_id: value.slice(7) } : { role: value, custom_role_id: null };
  const roleLabel = (value: string, customRoleName?: string | null) => customRoleName || (value.startsWith('CUSTOM:') ? customRoles.find(item => item.id === value.slice(7))?.name : null) || labels[value]?.[ar ? 0 : 1] || value;
  const roleOptions = (builtins: string[]) => <>{builtins.map(value => <option key={value} value={value}>{roleLabel(value)}</option>)}{customRoles.map(item => <option key={item.id} value={`CUSTOM:${item.id}`}>{item.name}</option>)}</>;
  const changeRolePermission = (key:string,checked:boolean) => setRolePermissions(current=>toggleRolePermission(current,key,checked));
  const resetEditor=()=>{setPresetId('');setEditingRoleId('');setRoleName('');setRoleDescription('');setRolePermissions([]);setPermissionSearch('');};
  const beginEdit=(item:CustomRole)=>{setPresetId('');setEditingRoleId(item.id);setRoleName(item.name);setRoleDescription(item.description);setRolePermissions(item.permissions);setActiveTab('create');};
  const editingTemplate=customRoles.some(r=>r.id===editingRoleId&&r.is_system_template);
  const visibleGroups=permissionGroups.map(g=>({...g,permissions:g.permissions.filter(p=>`${g.ar} ${g.en} ${p.ar} ${p.en} ${p.key}`.toLowerCase().includes(permissionSearch.toLowerCase()))})).filter(g=>g.permissions.length);
  const tabs=[{key:'roles',ar:'الأدوار المنشأة',en:'Created roles',icon:'roles'},{key:'create',ar:editingRoleId?'تعديل الدور':'إنشاء دور',en:editingRoleId?'Edit role':'Create role',icon:'add'},{key:'members',ar:'المستخدمون',en:'Members',icon:'users'},{key:'invites',ar:'الدعوات',en:'Invitations',icon:'mail'},{key:'governance',ar:'الحوكمة والصلاحيات',en:'Governance & access',icon:'shield'}];

  const inviteMessage = ar
    ? `دعوة للانضمام إلى ${organization?.name ?? 'الجهة'} في زكاة فلو\nالبريد المدعو: ${inviteEmail}\nالدور: ${roleLabel(inviteRole)}\nسجّل الدخول بالبريد نفسه لقبول الدعوة (صالحة لمدة 7 أيام): ${inviteUrl}`
    : `You are invited to join ${organization?.name ?? 'the organization'} on ZakatFlow.\nInvited email: ${inviteEmail}\nRole: ${roleLabel(inviteRole)}\nSign in using the same email to accept (valid for 7 days): ${inviteUrl}`;
  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(inviteMessage)}`;

  async function seedDefaultRoles(){setBusy(true);setNotice('');try{const r=await fetch('/api/organizations/permissions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({organization_id:organizationId})});const b=await r.json().catch(()=>({}));if(!r.ok)throw new Error(b.error??'REQUEST_FAILED');await loadUsers(organizationId);setNotice(ar?'تم تجهيز الأدوار الافتراضية القابلة للتعديل.':'Editable default roles are ready.');}catch(e){setNotice(message(e instanceof Error?e.message:'',ar));}finally{setBusy(false);}}
  async function savePolicy(policy:string){setBusy(true);try{const r=await fetch('/api/organizations/permissions',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({organization_id:organizationId,action:'policy',policy})});const b=await r.json().catch(()=>({}));if(!r.ok)throw new Error(b.error??'REQUEST_FAILED');setApprovalPolicy(policy);setNotice(ar?'تم حفظ سياسة الاعتماد.':'Approval policy saved.');}catch(e){setNotice(message(e instanceof Error?e.message:'',ar));}finally{setBusy(false);}}
  async function setOverride(userId:string,permission:string,effect:string){setBusy(true);try{const r=await fetch('/api/organizations/permissions',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({organization_id:organizationId,action:'override',user_id:userId,permission,effect:effect||null})});const b=await r.json().catch(()=>({}));if(!r.ok)throw new Error(b.error??'REQUEST_FAILED');await loadUsers(organizationId);setNotice(ar?'تم حفظ الاستثناء على صلاحيات المستخدم.':'User permission override saved.');}catch(e){setNotice(message(e instanceof Error?e.message:'',ar));}finally{setBusy(false);}}
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
      const templateRole = customRoles.find(item => item.id === editingRoleId && item.is_system_template);
      const response = templateRole
        ? await fetch('/api/organizations/permissions', { method:'PATCH', headers:{'content-type':'application/json'}, body:JSON.stringify({ organization_id:organizationId, action:'role', role_id:templateRole.id, permissions:rolePermissions, amount_limits:templateRole.amount_limits ?? {} }) })
        : await fetch('/api/organizations/roles', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organization_id: organizationId, id: editingRoleId || undefined, name: roleName, description: roleDescription, permissions: rolePermissions }) });
      const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(body.error ?? 'REQUEST_FAILED');
      setRoleName(''); setRoleDescription(''); setRolePermissions([]); setEditingRoleId('');setPresetId('');setPermissionSearch(''); setActiveTab('roles'); await loadUsers(organizationId);
      setNotice(ar ? 'تم حفظ الدور وصلاحياته.' : 'Role and permissions saved.');
    } catch (error) { setNotice(message(error instanceof Error ? error.message : '', ar)); }
    finally { setBusy(false); }
  }

  async function deleteCustomRole(id: string) {
    if(!window.confirm(ar?'حذف هذا الدور؟ لا يمكن حذف الدور المرتبط بأعضاء أو دعوات.':'Delete this role? Roles linked to members or invitations cannot be deleted.'))return;
    setBusy(true); setNotice('');
    try {
      const response = await fetch(`/api/organizations/roles?organization_id=${encodeURIComponent(organizationId)}&role_id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(body.error ?? 'REQUEST_FAILED');
      await loadUsers(organizationId); setNotice(ar ? 'تم حذف الدور.' : 'Role deleted.');
    } catch (error) { setNotice(message(error instanceof Error ? error.message : '', ar)); }
    finally { setBusy(false); }
  }

  return <main className={`container ${styles.accessPage}`} dir={ar ? 'rtl' : 'ltr'} style={{ maxWidth: 1180, paddingTop: 30, paddingBottom: 60 }}>
    <header style={{ marginBottom: 24 }}><span className="pill">{ar ? 'إدارة الوصول' : 'ACCESS MANAGEMENT'}</span><h1>{ar ? 'المستخدمون والصلاحيات' : 'Users & permissions'}</h1><p className="muted">{ar ? 'اربط حسابات الدخول بالجهات، وأدر أدوار الأعضاء والدعوات.' : 'Link sign-in accounts to organizations, and manage member roles and invitations.'}</p></header>
    {notice && <div className="card" role="status" style={{ marginBottom: 16 }}>{notice}</div>}
    <section className="card" style={{ marginBottom: 20 }}>
      <label style={{ display: 'grid', gap: 8, maxWidth: 540 }}><strong>{ar ? 'الجهة' : 'Organization'}</strong><select value={organizationId} onChange={event => { requestVersion.current++;setMembers([]);setInvitations([]);setCustomRoles([]);resetEditor();setOverrideUser('');setOrganizationId(event.target.value); setInviteUrl(''); setInviteEmail(''); }} disabled={loading || busy || !organizations.length} style={{ padding: 12 }}>
        {organizations.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      {!loading && !organizations.length && <p className="muted">{ar ? 'لا توجد جهات متاحة في حسابك.' : 'No organizations are available in your account.'}</p>}
    </section>
    {organization && <>
      <div className={styles.accessStats}>
        <article><span>{ar?'الأدوار المنشأة':'Created roles'}</span><strong>{customRoles.length}</strong></article>
        <article><span>{ar?'المستخدمون النشطون':'Active members'}</span><strong>{members.filter(m=>m.status==='ACTIVE').length}</strong></article>
        <article><span>{ar?'دعوات بانتظار القبول':'Pending invitations'}</span><strong>{invitations.filter(i=>!i.accepted_at&&new Date(i.expires_at)>new Date()).length}</strong></article>
        <article><span>{ar?'سياسة الاعتماد':'Approval policy'}</span><strong>{!governanceReady?'—':approvalPolicy==='STRICT_SEGREGATION'?(ar?'فصل المهام':'Segregated'):approvalPolicy==='ROLE_BASED'?(ar?'حسب الدور':'Role based'):(ar?'تحكم المالك':'Owner controlled')}</strong></article>
      </div>
      <nav className={styles.tabs} aria-label={ar?'إدارة المستخدمين والأدوار':'User and role management'}>{tabs.map(tab=><button key={tab.key} type="button" aria-current={activeTab===tab.key?'page':undefined} className={activeTab===tab.key?styles.activeTab:''} onClick={()=>setActiveTab(tab.key)}><AccessIcon name={tab.icon}/><span>{ar?tab.ar:tab.en}</span>{tab.key==='roles'&&<small>{customRoles.length}</small>}</button>)}</nav>
      {dataLoading&&<p role="status">{ar?'جارٍ تحميل الأدوار والمستخدمين…':'Loading roles and members…'}</p>}
      <button type="button" className="btn secondary" disabled={dataLoading || busy} onClick={()=>void loadUsers(organizationId)}><AccessIcon name="refresh"/>{ar?'تحديث البيانات':'Refresh data'}</button>
      <div aria-busy={dataLoading} inert={dataLoading || !['OWNER','ADMIN'].includes(actorRole) || undefined}>

      <section hidden={!['roles','create'].includes(activeTab)} className="card" style={{ marginBottom: 20 }}>
        <div className={styles.sectionHeading}>
          <div><h2>{ar ? 'الأدوار والصلاحيات' : 'Roles & permissions'}</h2><p className="muted">{ar ? 'أنشئ أدوارًا تناسب فريقك، واختر ما يمكن لكل دور عرضه أو إدارته.' : 'Create roles for your team and choose what each role can view or manage.'}</p></div>
          <span className={styles.roleCount}>{customRoles.length} {ar ? 'دور' : customRoles.length === 1 ? 'role' : 'roles'}</span>
        </div>
        <form hidden={activeTab!=='create'} onSubmit={saveCustomRole} className={styles.roleEditor}>
          {!editingRoleId&&<label className={styles.fieldLabel}><span>{ar?'البدء من قالب مقترح':'Start from a suggested template'}</span><select value={presetId} onChange={e=>{setPresetId(e.target.value);const preset=rolePresets.find(p=>p.id===e.target.value);if(preset){setRoleName(preset[ar?'ar':'en']);setRoleDescription('');setRolePermissions(preset.permissions.reduce((values,key)=>toggleRolePermission(values,key,true),[] as string[]));}else resetEditor();}}><option value="">{ar?'دور مخصص فارغ':'Blank custom role'}</option>{rolePresets.map(p=><option key={p.id} value={p.id}>{p[ar?'ar':'en']}</option>)}</select><small>{ar?'القالب اقتراح قابل للمراجعة؛ لا يتم إنشاء الدور أو تغيير أي مستخدم قبل الحفظ والإسناد.':'Templates are suggestions; no role or member changes until saved and assigned.'}</small></label>}
          <p className={styles.accessNote}>{ar?'الصلاحيات مرتبطة بالمنشأة المحددة فقط. تستخدم الوحدات الجديدة الصلاحيات المشتركة الموضحة في تبويب الحوكمة. القالب التنفيذي يتضمن الاعتماد اللازم للترحيل؛ افصل المسؤوليات بسياسة الاعتماد المناسبة.':'Permissions apply only to the selected organization. New modules share controls listed under Governance. The settlement template includes approval needed for posting; use approval policy to separate duties.'}</p>
          <div className={styles.editorTitle}>
            <div><span className={styles.stepLabel}>{editingRoleId ? (ar ? 'تعديل' : 'EDIT') : (ar ? 'دور جديد' : 'NEW ROLE')}</span><h3>{editingRoleId ? (ar ? 'تعديل الدور' : 'Edit role') : (ar ? 'إنشاء دور جديد' : 'Create a role')}</h3></div>
            {rolePermissions.length > 0 && <span className={styles.selectedCount}>{rolePermissions.length} {ar ? 'صلاحية محددة' : `permission${rolePermissions.length === 1 ? '' : 's'} selected`}</span>}
          </div>
          <div className={styles.roleFields}>
            <label className={styles.fieldLabel}><span>{ar ? 'اسم الدور' : 'Role name'}</span><input readOnly={editingTemplate} required minLength={2} maxLength={60} value={roleName} onChange={event => setRoleName(event.target.value)} placeholder={ar ? 'مثال: مسؤول السيولة' : 'e.g. Cash manager'} /></label>
            <label className={styles.fieldLabel}><span>{ar ? 'الوصف' : 'Description'} <small>{ar ? 'اختياري' : 'Optional'}</small></span><input readOnly={editingTemplate} maxLength={240} value={roleDescription} onChange={event => setRoleDescription(event.target.value)} placeholder={ar ? 'ما مسؤوليات هذا الدور؟' : 'What is this role responsible for?'} /></label>
          </div>
          <div className={styles.permissionHeader}><div><h4>{ar ? 'صلاحيات الدور' : 'Role permissions'}</h4><p className="muted">{ar ? 'اختر صلاحيات العرض والإدارة لكل وحدة.' : 'Choose view and management access for each module.'}</p></div><span>{ar ? 'تُضاف صلاحية العرض تلقائيًا عند اختيار الإدارة' : 'View access is included with management access'}</span></div>
          <label className={styles.fieldLabel}><span>{ar?'بحث في الوحدات والصلاحيات':'Search modules and permissions'}</span><input type="search" value={permissionSearch} onChange={e=>setPermissionSearch(e.target.value)} placeholder={ar?'مثال: الأصول، الاعتماد، السداد':'e.g. assets, approval, settlement'}/></label>
          {rolePermissions.some(p=>SENSITIVE_PERMISSIONS.has(p))&&<p className={styles.accessNote}>{ar?'يتضمن الدور صلاحيات حساسة للاعتماد أو الترحيل أو السداد. راجع فصل المهام قبل الإسناد.':'This role includes sensitive approval, posting or settlement permissions. Review segregation of duties before assignment.'}</p>}
          {!visibleGroups.length&&<p className="muted">{ar?'لا توجد صلاحيات مطابقة للبحث.':'No permissions match your search.'}</p>}
          <div className={styles.permissionGrid}>
            {visibleGroups.map(group => <section className={styles.permissionGroup} key={group.key} aria-labelledby={`permission-group-${group.key}`}>
              <div className={styles.groupHeading}><div><h5 id={`permission-group-${group.key}`}>{ar ? group.ar : group.en}</h5><p>{ar ? group.arDescription : group.enDescription}</p></div><span>{group.permissions.filter(item => rolePermissions.includes(item.key)).length}/{group.permissions.length}</span></div>
              <div className={styles.permissionList}>{group.permissions.map(item => <label className={`${styles.permissionOption} ${rolePermissions.includes(item.key) ? styles.permissionSelected : ''}`} key={item.key}>
                <input type="checkbox" checked={rolePermissions.includes(item.key)} onChange={event => changeRolePermission(item.key, event.target.checked)} />
                <span className={styles.permissionText}><strong>{ar ? item.ar : item.en}{SENSITIVE_PERMISSIONS.has(item.key)&&<em className={styles.sensitive}>{ar?'حساسة':'Sensitive'}</em>}</strong><small>{ar ? item.arHelp : item.enHelp}</small></span>
              </label>)}</div>
            </section>)}
          </div>
          <div className={styles.editorActions}>
            <button className="btn" type="submit" disabled={busy || (editingTemplate && actorRole!=='OWNER') || roleName.trim().length < 2}>{busy ? (ar ? 'جارٍ الحفظ…' : 'Saving…') : editingRoleId ? (ar ? 'حفظ التعديلات' : 'Save changes') : (ar ? 'إنشاء الدور' : 'Create role')}</button>
            {editingRoleId && <button className="btn secondary" type="button" disabled={busy} onClick={resetEditor}>{ar ? 'إلغاء التعديل' : 'Cancel editing'}</button>}
          </div>
        </form>
        <div hidden={activeTab!=='roles'}>
        <label className={styles.fieldLabel}><span>{ar?'بحث عن دور':'Find a role'}</span><input type="search" value={roleSearch} onChange={e=>setRoleSearch(e.target.value)} placeholder={ar?'اسم الدور أو وصفه':'Role name or description'}/></label>
        <div className={styles.rolesListHeading}><h3>{ar ? 'الأدوار المنشأة' : 'Created roles'}</h3><span>{customRoles.length}</span></div>
        {customRoles.length ? <div className={styles.rolesGrid}>{customRoles.filter(item=>`${item.name} ${item.description}`.toLowerCase().includes(roleSearch.toLowerCase())).map(item => <article className={styles.roleCard} key={item.id}>
          <div className={styles.roleCardHeader}><div className={styles.roleMark} aria-hidden="true">{item.name.trim().slice(0, 1).toLocaleUpperCase()}</div><div className={styles.roleCardTitle}><h4>{item.name}</h4><p>{item.description || (ar ? 'لا يوجد وصف' : 'No description')}</p></div></div>
          <div className={styles.roleMeta}><span>{item.is_system_template?(ar?'قالب افتراضي':'Default template'):(ar?'دور مخصص':'Custom role')}</span><span>{item.member_count} {ar ? 'عضو' : item.member_count === 1 ? 'member' : 'members'}</span><span>{item.permissions.length} {ar ? 'صلاحية' : 'permissions'}</span></div>
          <details className={styles.roleDetails}><summary>{ar?'عرض الصلاحيات':'View permissions'}</summary><div className={styles.permissionChips}>{item.permissions.length ? item.permissions.map(key => <span key={key}>{permissionOptions.find(permission => permission.key === key)?.[ar ? 'ar' : 'en'] ?? key}</span>) : <span>{ar ? 'بلا صلاحيات محددة' : 'No permissions selected'}</span>}</div></details>
          <div className={styles.roleCardActions}><button className="btn secondary" type="button" disabled={busy || item.is_editable===false || (item.is_system_template && actorRole!=='OWNER')} onClick={() => beginEdit(item)}>{ar ? 'تعديل' : 'Edit'}</button><button className="btn secondary" type="button" disabled={busy} onClick={()=>{resetEditor();setRoleName((item.name+(ar?' — نسخة':' — copy')).slice(0,60));setRoleDescription(item.description);setRolePermissions([...item.permissions]);setActiveTab('create');}}><AccessIcon name="copy"/>{ar?'نسخ':'Duplicate'}</button><button className="btn danger" type="button" disabled={busy || item.is_system_template || item.is_editable===false || item.member_count>0} onClick={() => void deleteCustomRole(item.id)}>{ar ? 'حذف' : 'Delete'}</button></div>
        </article>)}</div> : <div className={styles.emptyRoles}><span aria-hidden="true">＋</span><div><strong>{ar ? 'لا توجد أدوار مخصصة بعد' : 'No custom roles yet'}</strong><p>{ar ? 'أنشئ أول دور، ثم اسنده إلى عضو أو دعوة.' : 'Create the first role, then assign it to a member or invitation.'}</p></div></div>}
      {customRoles.length>0&&!customRoles.some(item=>`${item.name} ${item.description}`.toLowerCase().includes(roleSearch.toLowerCase()))&&<p className="muted">{ar?'لا توجد أدوار مطابقة للبحث.':'No roles match your search.'}</p>}
      </div></section>
      <section hidden={activeTab!=='governance'} className="card" style={{marginBottom:20}}>
        <h2>{ar?'حوكمة الأدوار والاعتماد':'Roles & approval governance'}</h2>
        <p className="muted">{ar?'أدوار جاهزة قابلة للتعديل، مع سياسة اعتماد واستثناءات صلاحيات لكل مستخدم.':'Editable role templates, approval policy, and per-user permission overrides.'}</p>
        <fieldset disabled={busy||!governanceReady||actorRole!=='OWNER'}><div style={{display:'flex',gap:10,flexWrap:'wrap',alignItems:'end',marginBottom:16}}>
          <label style={{display:'grid',gap:6,minWidth:280}}><span>{ar?'سياسة الاعتماد':'Approval policy'}</span><select value={approvalPolicy} disabled={busy||!governanceReady} onChange={e=>void savePolicy(e.target.value)}><option value="OWNER_CONTROLLED">{ar?'تحكم المالك — يسمح للمالك بالاعتماد الذاتي':'Owner controlled'}</option><option value="ROLE_BASED">{ar?'حسب الدور والصلاحيات':'Role based'}</option><option value="STRICT_SEGREGATION">{ar?'فصل صارم — المنشئ لا يعتمد عمليته':'Strict segregation'}</option></select></label>
          <button className="btn secondary" type="button" disabled={busy} onClick={()=>void seedDefaultRoles()}>{ar?'تجهيز/استعادة الأدوار الافتراضية':'Seed/restore default roles'}</button>
        </div>
        </fieldset><div className={styles.coverageGrid}>{moduleCoverage.map(m=><article key={m.en}><strong>{m[ar?'ar':'en']}</strong><p>{m.keys.map(k=>permissionOptions.find(p=>p.key===k)?.[ar?'ar':'en']??k).join(' · ')}</p></article>)}</div>{actorRole!=='OWNER'&&<p className={styles.accessNote}>{ar?'تعديل القوالب وسياسة الاعتماد واستثناءات المستخدمين متاح للمالك فقط.':'Only the owner can edit templates, approval policy and user overrides.'}</p>}<p className={styles.accessNote}>{ar?'هذه مجموعات صلاحيات مشتركة، وليست فصلًا مستقلًا لكل موديول. منح إدارة الأصول يمنح أيضًا إدارة الاستثمار، ومنح إنشاء المحرك المالي يتيح مهام الذمم والقروض والسلف وفق ضوابطها. السداد والترحيل يحتاجان الاعتماد والصلاحيات الإضافية للعملية. الاستثناءات أدناه تخص المسارات التي تستخدم محرك الصلاحيات الفعّالة؛ بعض الوحدات القديمة تتحقق من الدور مباشرة.':'These are shared permission groups, not independent module isolation. Asset management also covers investments; financial creation supports balance, loan and advance workflows. Settlement and posting require approval and additional action permissions. Overrides apply to effective-permission paths; some legacy modules check roles directly.'}</p>
        <div className={styles.rolesGrid}>{customRoles.filter(r=>r.is_system_template).map(r=><article className={styles.roleCard} key={r.id}><div><strong>{r.name}</strong><p>{r.description}</p></div><div className={styles.permissionChips}>{r.permissions.map(k=><span key={k}>{permissionOptions.find(p=>p.key===k)?.[ar?'ar':'en']??k}</span>)}</div><button className="btn secondary" type="button" disabled={busy || r.is_editable===false || actorRole!=='OWNER'} onClick={()=>beginEdit(r)}>{ar?'تعديل الصلاحيات':'Edit permissions'}</button></article>)}</div>
        <fieldset disabled={busy||!governanceReady||actorRole!=='OWNER'}><h3 style={{marginTop:18}}>{ar?'استثناءات المستخدمين':'User overrides'}</h3>
        <label className={styles.fieldLabel}><span>{ar?'اختر المستخدم لعرض الاستثناءات':'Choose a member to review overrides'}</span><select value={overrideUser} onChange={e=>setOverrideUser(e.target.value)}><option value="">{ar?'اختر مستخدمًا':'Choose a member'}</option>{members.filter(m=>m.role!=='OWNER'&&m.status==='ACTIVE').map(m=><option key={m.user_id} value={m.user_id}>{m.name||m.email}</option>)}</select></label>
        <div style={{overflowX:'auto'}}><table className="table"><thead><tr><th>{ar?'المستخدم':'User'}</th><th>{ar?'الصلاحية':'Permission'}</th><th>{ar?'الحالة':'Override'}</th></tr></thead><tbody>{members.filter(m=>m.role!=='OWNER'&&m.status==='ACTIVE'&&m.user_id===overrideUser).flatMap(m=>permissionOptions.map(p=>{const ov=permissionOverrides.find(x=>x.user_id===m.user_id&&x.permission===p.key);return <tr key={m.user_id+p.key}><td>{m.name||m.email}</td><td>{p[ar?'ar':'en']}</td><td><select disabled={busy} value={ov?.effect??''} onChange={e=>void setOverride(m.user_id,p.key,e.target.value)}><option value="">{ar?'يرث من الدور':'Inherit role'}</option><option value="ALLOW">{ar?'سماح إضافي':'Allow'}</option><option value="DENY">{ar?'منع صريح':'Deny'}</option></select></td></tr>;}))}</tbody></table></div></fieldset>
      </section>
      <section hidden={activeTab!=='invites'} className="card" style={{ marginBottom: 20 }}><h2>{ar ? 'دعوة مستخدم' : 'Invite a user'}</h2><p className="muted">{ar ? 'يُنشأ رابط دعوة صالح لمدة سبعة أيام. على المدعو تسجيل الدخول بالبريد نفسه لقبولها.' : 'The invite link is valid for seven days. The invitee must sign in with the same email to accept it.'}</p>
        <form className={styles.inviteForm} onSubmit={createInvite} style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 2fr) minmax(150px, 1fr) auto', gap: 10, alignItems: 'end' }}>
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
      <section hidden={activeTab!=='members'} className="card" style={{ marginBottom: 20, overflowX: 'auto' }}><h2>{ar ? 'أعضاء الجهة' : 'Organization members'}</h2>
        <table className="table"><thead><tr><th>{ar ? 'المستخدم' : 'User'}</th><th>{ar ? 'الدور' : 'Role'}</th><th>{ar ? 'الحالة' : 'Status'}</th><th>{ar ? 'إجراءات' : 'Actions'}</th></tr></thead><tbody>
          {members.map(member => <tr key={member.user_id}><td><strong>{member.name || member.email}</strong><br /><small className="muted">{member.email}</small></td><td>{member.role === 'OWNER' ? roleLabel(member.role) : <select value={roleValue(member.role, member.custom_role_id)} disabled={busy || member.user_id===actorId || (member.role==='ADMIN' && actorRole!=='OWNER')} onChange={event => void updateMember(member, event.target.value, member.status)}>{roleOptions(memberRoles)}</select>}</td><td>{member.status === 'ACTIVE' ? (ar ? 'نشط' : 'Active') : (ar ? 'موقوف' : 'Inactive')}</td><td>{member.role !== 'OWNER' && <button className="btn secondary" type="button" disabled={busy || member.user_id===actorId || (member.role==='ADMIN' && actorRole!=='OWNER')} onClick={() => void updateMember(member, roleValue(member.role, member.custom_role_id), member.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE')}>{member.status === 'ACTIVE' ? (ar ? 'إيقاف' : 'Suspend') : (ar ? 'إعادة تفعيل' : 'Reactivate')}</button>}</td></tr>)}
          {!members.length && <tr><td colSpan={4} className="muted">{ar ? 'لا توجد عضويات، أو لا تملك صلاحية الإدارة.' : 'No members found, or you do not have management access.'}</td></tr>}
        </tbody></table>
      </section>
      <section hidden={activeTab!=='invites'} className="card" style={{ overflowX: 'auto' }}><h2>{ar ? 'الدعوات' : 'Invitations'}</h2><table className="table"><thead><tr><th>{ar ? 'البريد' : 'Email'}</th><th>{ar ? 'الدور' : 'Role'}</th><th>{ar ? 'الحالة' : 'Status'}</th><th>{ar ? 'الإجراء' : 'Action'}</th></tr></thead><tbody>
        {invitations.map(invitation => { const accepted = !!invitation.accepted_at; const expired = new Date(invitation.expires_at) <= new Date(); return <tr key={invitation.id}><td>{invitation.email}</td><td>{roleLabel(invitation.role, invitation.custom_role_name)}</td><td>{accepted ? (ar ? 'مقبولة' : 'Accepted') : expired ? (ar ? 'منتهية' : 'Expired') : (ar ? 'بانتظار القبول' : 'Pending')}</td><td>{!accepted && <button className="btn secondary" type="button" disabled={busy} onClick={() => void revokeInvite(invitation.id)}>{ar ? 'إلغاء' : 'Revoke'}</button>}</td></tr>; })}
        {!invitations.length && <tr><td colSpan={4} className="muted">{ar ? 'لا توجد دعوات.' : 'No invitations.'}</td></tr>}
      </tbody></table></section>
    </div></>}
  </main>;
}

function message(code: string, ar: boolean) {
  const map: Record<string, [string, string]> = {
    ROLE_PERMISSION_INVALID: ['إحدى الصلاحيات غير مدعومة. أعد تحميل الصفحة.', 'A permission is unsupported. Reload the page.'],
    ROLE_IN_USE: ['الدور مرتبط بأعضاء أو دعوات؛ غيّر الإسناد قبل حذفه.', 'Reassign linked members or invitations before deleting this role.'],
    ROLE_LOCKED: ['هذا الدور محمي من التعديل أو الحذف.', 'This role is protected from editing or deletion.'],
    OWNER_REQUIRED_TO_MANAGE_PERMISSIONS: ['إدارة صلاحيات القوالب والسياسات تتطلب المالك.', 'Template permissions and policy management require the owner.'],
    OWNER_REQUIRED_TO_SEED_ROLES: ['تجهيز القوالب يتطلب المالك.', 'Seeding templates requires the owner.'],
    ROLE_NAME_INVALID: ['اسم الدور يجب أن يكون بين حرفين و60 حرفًا.', 'Role name must contain 2–60 characters.'],
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

function AccessIcon({name}:{name:string}){
 const paths:Record<string,string>={refresh:'M20 7a8 8 0 1 0 0 10M20 3v5h-5',copy:'M9 9h12v12H9zM15 9V3H3v12h6',roles:'M12 3 3 7l9 4 9-4-9-4ZM3 12l9 4 9-4M3 17l9 4 9-4',add:'M12 5v14M5 12h14',users:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',mail:'M4 4h16v16H4zM4 6l8 7 8-7',shield:'M12 3 3 7v5c0 5 9 9 9 9s9-4 9-9V7l-9-4Zm-4 9 3 3 5-5'};
 return <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]??paths.roles}/></svg>;
}
