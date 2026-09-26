'use client';

import { FormEvent, KeyboardEvent, use, useEffect, useMemo, useState } from 'react';
import { getVatPeriod, type VatFilingFrequency } from '@/lib/vat-period';
import type { VatDocumentForSummary } from '@/lib/vat';
import { organizationDisplayName } from '@/lib/organization-display';
import { VatEInvoiceSetup } from '@/components/vat-einvoice-setup';
import { VatEInvoiceRegister } from '@/components/vat-einvoice-register';
import { VatManagementDashboard, VatPeriodSummaryForm } from '@/components/vat-period-workspace';
import type { VatPeriodSummaryRecord } from '@/lib/vat-period-summary';
import { aggregateVatDashboardTotals, type VatDashboardTotals } from '@/lib/vat-dashboard-summary';
import './vat.css';

type Organization = {
  id: string;
  name: string;
  organization_kind?: 'HOLDING' | 'SUBSIDIARY';
  parent_organization_id?: string | null;
  sort_order?: number;
};

type VatProfile = {
  id: string;
  organization_id: string;
  tax_registration_number: string | null;
  registration_status: 'NOT_REGISTERED' | 'REGISTERED' | 'PENDING' | 'DEREGISTERED';
  registration_date: string | null;
  filing_frequency: VatFilingFrequency;
  standard_rate: number;
  period_start_month: number;
};

type VatDocument = VatDocumentForSummary & {
  id: string;
  document_number: string;
  transaction_date: string;
  counterparty_name: string;
  document_type: 'SALES' | 'PURCHASE';
  document_kind: 'INVOICE' | 'CREDIT_NOTE';
  supply_type: 'STANDARD' | 'ZERO_RATED' | 'EXEMPT' | 'OUT_OF_SCOPE';
  tax_rate: number;
  tax_amount: number;
  gross_amount: number;
  notes?: string | null;
  is_einvoice?: boolean;
};

type VatProfileDraft = {
  tax_registration_number: string;
  registration_status: VatProfile['registration_status'];
  registration_date: string;
  filing_frequency: VatFilingFrequency;
  standard_rate: string;
  period_start_month: string;
};

type DocumentDraft = {
  document_type: 'SALES' | 'PURCHASE';
  document_kind: 'INVOICE' | 'CREDIT_NOTE';
  document_number: string;
  transaction_date: string;
  counterparty_name: string;
  counterparty_tax_number: string;
  supply_type: 'STANDARD' | 'ZERO_RATED' | 'EXEMPT' | 'OUT_OF_SCOPE';
  net_amount: string;
  recoverable_percent: string;
  notes: string;
};

type ApiData = {
  profile: VatProfile | null;
  period: { from: string; to: string };
  yearStart: string;
  periodSummary: VatPeriodSummaryRecord | null;
  periodTotals: VatDashboardTotals;
  annualTotals: VatDashboardTotals;
  documents: VatDocument[];
};

const currentMonth = () => {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
};
const emptyProfile: VatProfileDraft = {
  tax_registration_number: '',
  registration_status: 'NOT_REGISTERED',
  registration_date: '',
  filing_frequency: 'QUARTERLY',
  standard_rate: '15',
  period_start_month: '1',
};
const emptyDocument = (): DocumentDraft => ({
  document_type: 'SALES',
  document_kind: 'INVOICE',
  document_number: '',
  transaction_date: new Date().toISOString().slice(0, 10),
  counterparty_name: '',
  counterparty_tax_number: '',
  supply_type: 'STANDARD',
  net_amount: '',
  recoverable_percent: '100',
  notes: '',
});

export default function VatManagement({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  const ar = locale === 'ar';
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [organizationId, setOrganizationId] = useState('');
  const [periodMonth, setPeriodMonth] = useState(currentMonth);
  const [profile, setProfile] = useState<VatProfile | null>(null);
  const [profileDraft, setProfileDraft] = useState<VatProfileDraft>(emptyProfile);
  const [documents, setDocuments] = useState<VatDocument[]>([]);
  const [period, setPeriod] = useState(() => getVatPeriod(currentMonth(), 'QUARTERLY'));
  const [yearStart, setYearStart] = useState(`${new Date().getFullYear()}-01-01`);
  const [periodSummary, setPeriodSummary] = useState<VatPeriodSummaryRecord | null>(null);
  const [periodTotals, setPeriodTotals] = useState<VatDashboardTotals>(emptyTotals());
  const [annualTotals, setAnnualTotals] = useState<VatDashboardTotals>(emptyTotals());
  const [reportScope, setReportScope] = useState<'COMPANY' | 'GROUP'>('COMPANY');
  const [branchVatData, setBranchVatData] = useState<ApiData[]>([]);
  const [loadingOrganizations, setLoadingOrganizations] = useState(true);
  const [loadingData, setLoadingData] = useState(false);
  const [saving, setSaving] = useState(false);
  const [invoiceRefresh, setInvoiceRefresh] = useState(0);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileDetailsOpen, setProfileDetailsOpen] = useState(false);
  const [periodDetailsOpen, setPeriodDetailsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'aggregate' | 'register' | 'einvoicing'>('dashboard');
  const [draft, setDraft] = useState<DocumentDraft>(emptyDocument);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const sortedOrganizations = useMemo(
    () => [...organizations].sort((a, b) => Number(a.sort_order ?? 100) - Number(b.sort_order ?? 100) || a.name.localeCompare(b.name)),
    [organizations],
  );
  const selectedOrganization = organizations.find((organization) => organization.id === organizationId);
  const reportOrganizationIds = useMemo(() => {
    if (!organizationId) return [];
    const children = new Map<string, string[]>();
    for (const organization of organizations) {
      if (!organization.parent_organization_id) continue;
      const list = children.get(organization.parent_organization_id) ?? [];
      list.push(organization.id);
      children.set(organization.parent_organization_id, list);
    }
    const descendants: string[] = [];
    const visited = new Set([organizationId]);
    const queue = [...(children.get(organizationId) ?? [])];
    while (queue.length) {
      const id = queue.shift()!;
      if (visited.has(id)) continue;
      visited.add(id);
      descendants.push(id);
      queue.push(...(children.get(id) ?? []));
    }
    return [organizationId, ...descendants];
  }, [organizationId, organizations]);
  const branchOrganizationIds = reportOrganizationIds.slice(1);
  const branchOrganizationKey = branchOrganizationIds.join(',');
  const hasBranches = branchOrganizationIds.length > 0;
  const currentTaxRate = Number(profile?.standard_rate ?? profileDraft.standard_rate ?? 15);
  const previewTax = draft.supply_type === 'STANDARD'
    ? (Number(draft.net_amount || 0) * currentTaxRate / 100)
    : 0;

  function handleTabKeyDown(event: KeyboardEvent<HTMLElement>) {
    const forward = ar ? 'ArrowLeft' : 'ArrowRight';
    const backward = ar ? 'ArrowRight' : 'ArrowLeft';
    if (![forward, backward, 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const tabs = ['dashboard', 'aggregate', 'register', 'einvoicing'] as const;
    const current = tabs.indexOf(activeTab);
    const nextTab = event.key === 'Home' ? tabs[0]
      : event.key === 'End' ? tabs[tabs.length - 1]
        : tabs[(current + (event.key === forward ? 1 : -1) + tabs.length) % tabs.length];
    setActiveTab(nextTab);
    document.getElementById(`vat-tab-${nextTab}`)?.focus();
  }

  useEffect(() => {
    let active = true;
    fetch('/api/organizations')
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body?.error || `HTTP_${response.status}`);
        return body as Organization[];
      })
      .then((rows) => {
        if (!active) return;
        setOrganizations(rows);
        const holding = rows.find((item) => item.organization_kind === 'HOLDING' && !item.parent_organization_id);
        setOrganizationId((holding ?? rows[0])?.id ?? '');
      })
      .catch((error) => setNotice({ kind: 'error', text: messageFor(error.message, ar) }))
      .finally(() => { if (active) setLoadingOrganizations(false); });
    return () => { active = false; };
  }, [ar]);

  useEffect(() => {
    if (!organizationId) return;
    let active = true;
    setLoadingData(true);
    setBranchVatData([]);
    const load = async (id: string): Promise<ApiData> => {
      const response = await fetch(`/api/vat?organization_id=${encodeURIComponent(id)}&period_month=${encodeURIComponent(periodMonth)}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || `HTTP_${response.status}`);
      return body as ApiData;
    };
    Promise.all([
      load(organizationId),
      reportScope === 'GROUP'
        ? Promise.all(branchOrganizationIds.map(load))
        : Promise.resolve([] as ApiData[]),
    ])
      .then(([body, branches]) => {
        if (!active) return;
        setProfile(body.profile);
        setDocuments(body.documents);
        setPeriod(body.period);
        setYearStart(body.yearStart);
        setPeriodSummary(body.periodSummary);
        setPeriodTotals(body.periodTotals);
        setAnnualTotals(body.annualTotals);
        setBranchVatData(branches);
        setProfileDraft(body.profile ? {
          tax_registration_number: body.profile.tax_registration_number ?? '',
          registration_status: body.profile.registration_status,
          registration_date: body.profile.registration_date ?? '',
          filing_frequency: body.profile.filing_frequency,
          standard_rate: String(body.profile.standard_rate),
          period_start_month: String(body.profile.period_start_month),
        } : emptyProfile);
      })
      .catch((error) => {
        if (!active) return;
        if (reportScope === 'GROUP') setReportScope('COMPANY');
        setNotice({ kind: 'error', text: reportScope === 'GROUP'
          ? (ar ? 'تعذر تحميل بيانات جميع الفروع؛ أُعيد التقرير إلى مستوى الشركة.' : 'Could not load every branch; the report has been reset to company level.')
          : messageFor(error.message, ar) });
      })
      .finally(() => { if (active) setLoadingData(false); });
    return () => { active = false; };
  }, [organizationId, periodMonth, ar, invoiceRefresh, reportScope, branchOrganizationKey]);

  useEffect(() => {
    if (!hasBranches && reportScope === 'GROUP') setReportScope('COMPANY');
  }, [hasBranches, reportScope]);

  const dashboardPeriodTotals = useMemo(
    () => reportScope === 'GROUP' ? aggregateVatDashboardTotals([periodTotals, ...branchVatData.map((branch) => branch.periodTotals)]) : periodTotals,
    [reportScope, periodTotals, branchVatData],
  );
  const dashboardAnnualTotals = useMemo(
    () => reportScope === 'GROUP' ? aggregateVatDashboardTotals([annualTotals, ...branchVatData.map((branch) => branch.annualTotals)]) : annualTotals,
    [reportScope, annualTotals, branchVatData],
  );

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId) return;
    setSaving(true);
    setNotice(null);
    try {
      const response = await fetch('/api/vat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save_profile',
          organization_id: organizationId,
          ...profileDraft,
          tax_registration_number: profileDraft.tax_registration_number.trim() || null,
          registration_date: profileDraft.registration_date || null,
          standard_rate: Number(profileDraft.standard_rate),
          period_start_month: Number(profileDraft.period_start_month),
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || `HTTP_${response.status}`);
      setProfile(body);
      setProfileOpen(false);
      setNotice({ kind: 'success', text: ar ? 'تم حفظ إعدادات ضريبة القيمة المضافة.' : 'VAT settings saved.' });
    } catch (error: any) {
      setNotice({ kind: 'error', text: messageFor(error.message, ar) });
    } finally {
      setSaving(false);
    }
  }

  async function addDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId) return;
    setSaving(true);
    setNotice(null);
    try {
      const response = await fetch('/api/vat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add_document',
          organization_id: organizationId,
          ...draft,
          net_amount: Number(draft.net_amount),
          recoverable_percent: draft.document_type === 'PURCHASE' ? Number(draft.recoverable_percent) : 100,
          counterparty_tax_number: draft.counterparty_tax_number.trim() || null,
          notes: draft.notes.trim() || null,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || `HTTP_${response.status}`);
      setDraft(emptyDocument());
      setNotice({ kind: 'success', text: ar ? 'تم تسجيل المستند الضريبي.' : 'VAT document recorded.' });
      await reloadData();
    } catch (error: any) {
      setNotice({ kind: 'error', text: messageFor(error.message, ar) });
    } finally {
      setSaving(false);
    }
  }

  async function deleteDocument(documentId: string) {
    if (!organizationId || !window.confirm(ar ? 'حذف هذا المستند من السجل؟' : 'Delete this document from the register?')) return;
    setSaving(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/vat?organization_id=${encodeURIComponent(organizationId)}&document_id=${encodeURIComponent(documentId)}`, { method: 'DELETE' });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || `HTTP_${response.status}`);
      setNotice({ kind: 'success', text: ar ? 'تم حذف المستند.' : 'Document deleted.' });
      await reloadData();
    } catch (error: any) {
      setNotice({ kind: 'error', text: messageFor(error.message, ar) });
    } finally {
      setSaving(false);
    }
  }

  async function reloadData() {
    if (!organizationId) return;
    const response = await fetch(`/api/vat?organization_id=${encodeURIComponent(organizationId)}&period_month=${encodeURIComponent(periodMonth)}`);
    const body = await response.json();
    if (!response.ok) throw new Error(body?.error || `HTTP_${response.status}`);
    setProfile(body.profile);
    setDocuments(body.documents);
    setPeriod(body.period);
    setYearStart(body.yearStart);
    setPeriodSummary(body.periodSummary);
    setPeriodTotals(body.periodTotals);
    setAnnualTotals(body.annualTotals);
  }

  const isRegistered = profile?.registration_status === 'REGISTERED';

  return (
    <main className="container vat-page" dir={ar ? 'rtl' : 'ltr'}>
      <header className="vat-header">
        <div>
          <span className="vat-eyebrow">{ar ? 'الالتزام الضريبي' : 'TAX COMPLIANCE'}</span>
          <h1>{ar ? 'إدارة ضريبة القيمة المضافة' : 'VAT management'}</h1>
          <p>{ar ? 'إعداد بيانات التسجيل، تنظيم مستندات المبيعات والمشتريات، وتجهيز ملخص الإقرار.' : 'Manage registration details, sales and purchase documents, and prepare a return summary.'}</p>
        </div>
        <label className="vat-picker">
          <span>{ar ? 'الشركة أو المؤسسة' : 'Company or organization'}</span>
            <select value={organizationId} onChange={(event) => { setOrganizationId(event.target.value); setReportScope('COMPANY'); }} disabled={loadingOrganizations || organizations.length === 0}>
            {sortedOrganizations.map((organization) => <option key={organization.id} value={organization.id}>{organizationDisplayName(organization.name, ar)}</option>)}
          </select>
        </label>
      </header>

      {notice && <div className={`vat-notice ${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.text}</div>}

      {loadingOrganizations ? <div className="vat-loading" role="status">{ar ? 'جارٍ تحميل الشركات…' : 'Loading organizations…'}</div> : !organizations.length ? (
        <section className="vat-panel vat-empty">
          <h2>{ar ? 'لا توجد مؤسسة مرتبطة بالحساب' : 'No organization is linked to this account'}</h2>
          <p>{ar ? 'أضف المؤسسة أولًا من صفحة الهيكل المؤسسي.' : 'Add an organization from Organization Structure first.'}</p>
          <a className="vat-button primary" href={`/${locale}/organizations`}>{ar ? 'إدارة المؤسسات' : 'Manage organizations'}</a>
        </section>
      ) : (
        <>
          <div className={`vat-settings-grid ${profileOpen || !profile ? 'is-editing' : ''}`}>
            <section className={`vat-panel vat-registration vat-config-panel ${profile && !profileOpen ? 'has-summary' : ''}`}>
              {profile && !profileOpen ? (
                <div className={`vat-config-summary ${profileDetailsOpen ? 'is-open' : ''}`}>
                  <button type="button" className="vat-config-summary-trigger" aria-expanded={profileDetailsOpen} aria-label={profileDetailsOpen ? (ar ? 'إخفاء تفاصيل التسجيل' : 'Hide registration details') : (ar ? 'عرض تفاصيل التسجيل' : 'Show registration details')} aria-controls="vat-registration-details" onClick={() => setProfileDetailsOpen((open) => !open)}>
                    <span className="vat-config-icon registration" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M7 3.75h7l4 4v12.5H7a2 2 0 0 1-2-2v-12.5a2 2 0 0 1 2-2Z"/><path d="M14 4v4h4M8.5 12h7M8.5 15.5h7"/></svg></span>
                    <span className="vat-config-copy">
                      <span className="vat-eyebrow">{ar ? 'ملف التسجيل' : 'REGISTRATION PROFILE'}</span>
                      <strong>{selectedOrganization ? organizationDisplayName(selectedOrganization.name, ar) : (ar ? 'الجهة المحددة' : 'Selected organization')}</strong>
                      <small>{ar ? 'بيانات المنشأة المسجلة' : 'Registered entity details'}</small>
                    </span>
                    <span className={`vat-status ${profile.registration_status.toLowerCase()}`}>{registrationLabel(profile.registration_status, ar)}</span>
                    <span className={`vat-config-plus ${profileDetailsOpen ? 'is-open' : ''}`} aria-hidden="true"><svg viewBox="0 0 20 20" fill="none"><path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg></span>
                  </button>
                  <button type="button" className="vat-icon-button vat-registration-edit" aria-label={ar ? 'تعديل ملف التسجيل' : 'Edit registration profile'} title={ar ? 'تعديل الإعدادات' : 'Edit settings'} onClick={() => setProfileOpen(true)}>
                    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m12.8 4.2 3 3M4 16l3.2-.7L15.8 6.7a1.5 1.5 0 0 0-2.1-2.1L5.1 13.2 4 16Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </button>
                </div>
              ) : (
                <>
                  <div className="vat-panel-head">
                    <div>
                      <span className="vat-eyebrow">{ar ? 'ملف التسجيل' : 'REGISTRATION PROFILE'}</span>
                      <h2>{ar ? 'بيانات المنشأة المسجلة' : 'Registered entity details'}</h2>
                      <p>{selectedOrganization ? organizationDisplayName(selectedOrganization.name, ar) : ''}</p>
                    </div>
                  </div>
                  <form className="vat-form-grid" onSubmit={saveProfile}>
                <label><span>{ar ? 'حالة التسجيل' : 'Registration status'}</span><select value={profileDraft.registration_status} onChange={(event) => setProfileDraft({ ...profileDraft, registration_status: event.target.value as VatProfileDraft['registration_status'] })}><option value="NOT_REGISTERED">{ar ? 'غير مسجل' : 'Not registered'}</option><option value="REGISTERED">{ar ? 'مسجل' : 'Registered'}</option><option value="PENDING">{ar ? 'طلب قيد الإجراء' : 'Pending'}</option><option value="DEREGISTERED">{ar ? 'ملغى التسجيل' : 'Deregistered'}</option></select></label>
                <label><span>{ar ? 'رقم التسجيل الضريبي' : 'VAT registration number'}</span><input value={profileDraft.tax_registration_number} maxLength={30} onChange={(event) => setProfileDraft({ ...profileDraft, tax_registration_number: event.target.value })} required={profileDraft.registration_status === 'REGISTERED'} placeholder={ar ? 'أدخل رقم التسجيل' : 'Enter registration number'} /></label>
                <label><span>{ar ? 'تاريخ التسجيل' : 'Registration date'}</span><input type="date" value={profileDraft.registration_date} onChange={(event) => setProfileDraft({ ...profileDraft, registration_date: event.target.value })} /></label>
                <label><span>{ar ? 'دورية الإقرار' : 'Filing frequency'}</span><select value={profileDraft.filing_frequency} onChange={(event) => setProfileDraft({ ...profileDraft, filing_frequency: event.target.value as VatFilingFrequency })}><option value="MONTHLY">{ar ? 'شهري' : 'Monthly'}</option><option value="QUARTERLY">{ar ? 'ربع سنوي' : 'Quarterly'}</option></select></label>
                <label><span>{ar ? 'النسبة الأساسية' : 'Standard VAT rate'}</span><input type="text" value="15%" readOnly aria-readonly="true" /><small className="vat-field-hint">{ar ? 'النسبة الأساسية المعتمدة حاليًا في السعودية' : 'Current Saudi standard rate'}</small></label>
                <label><span>{ar ? 'شهر بداية السنة الضريبية' : 'Tax year start month'}</span><select value={profileDraft.period_start_month} onChange={(event) => setProfileDraft({ ...profileDraft, period_start_month: event.target.value })}>{Array.from({ length: 12 }, (_, index) => <option key={index + 1} value={index + 1}>{monthLabel(index + 1, ar)}</option>)}</select></label>
                <div className="vat-form-actions">
                  {profile && <button type="button" className="vat-button secondary" onClick={() => setProfileOpen(false)}>{ar ? 'إلغاء' : 'Cancel'}</button>}
                  <button className="vat-button primary" disabled={saving}>{saving ? (ar ? 'جارٍ الحفظ…' : 'Saving…') : (ar ? 'حفظ ملف التسجيل' : 'Save registration')}</button>
                </div>
                  </form>
                </>
              )}
              {profile && !profileOpen && <div id="vat-registration-details" className="vat-config-details" hidden={!profileDetailsOpen}>
                <div className="vat-config-details-grid registration-details-grid">
                  <div><small>{ar ? 'الرقم الضريبي' : 'VAT number'}</small><strong dir="ltr">{profile.tax_registration_number || '—'}</strong></div>
                  <div><small>{ar ? 'تاريخ التسجيل' : 'Registration date'}</small><strong>{profile.registration_date || '—'}</strong></div>
                  <div><small>{ar ? 'النسبة الأساسية' : 'Standard rate'}</small><strong>{Number(profile.standard_rate).toFixed(2)}%</strong></div>
                </div>
              </div>}
            </section>

            <section className={`vat-panel vat-config-panel vat-period-config ${periodDetailsOpen ? 'is-open' : ''}`}>
              <button type="button" className="vat-config-summary-trigger vat-period-summary-trigger" aria-expanded={periodDetailsOpen} aria-label={periodDetailsOpen ? (ar ? 'إخفاء خيارات الفترة الضريبية' : 'Hide tax period options') : (ar ? 'عرض خيارات الفترة الضريبية' : 'Show tax period options')} aria-controls="vat-period-details" onClick={() => setPeriodDetailsOpen((open) => !open)}>
                <span className="vat-config-icon period" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3.5" y="5" width="17" height="16" rx="2.5"/><path d="M7.5 3v4M16.5 3v4M3.5 10h17M7.5 14h3M13.5 14h3"/></svg></span>
                <span className="vat-config-copy">
                  <span className="vat-eyebrow">{ar ? 'الفترة الضريبية' : 'TAX PERIOD'}</span>
                  <strong dir="ltr">{period.from} — {period.to}</strong>
                  <small><span>{ar ? 'الدورية' : 'Frequency'}</span><span className="vat-period-frequency">{profile ? frequencyLabel(profile.filing_frequency, ar) : (ar ? 'دورية افتراضية' : 'Default frequency')}</span></small>
                </span>
                <span className={`vat-config-plus ${periodDetailsOpen ? 'is-open' : ''}`} aria-hidden="true"><svg viewBox="0 0 20 20" fill="none"><path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg></span>
              </button>
              <div id="vat-period-details" className="vat-config-details vat-period-details" hidden={!periodDetailsOpen}>
                <p className="vat-period-help">{ar ? 'اختر شهرًا من الفترة وحدد نطاق بيانات لوحة الإدارة.' : 'Choose a month in the period and set the dashboard reporting scope.'}</p>
                <div className="vat-period-controls vat-period-config-controls">
                  <label className="vat-period-select vat-filter-field">
                    <span className="vat-filter-label"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="16" rx="2.5"/><path d="M7.5 3v4M16.5 3v4M3.5 10h17"/></svg>{ar ? 'الشهر ضمن الفترة' : 'Month in period'}</span>
                    <input type="month" value={periodMonth} onChange={(event) => setPeriodMonth(event.target.value)} />
                  </label>
                  {activeTab === 'dashboard' && hasBranches && <label className="vat-period-select vat-report-scope vat-filter-field">
                    <span className="vat-filter-label"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3.5" y="4" width="17" height="7" rx="1.5"/><path d="M6 11v8M18 11v8M3.5 19h17M8 7.5h.01M12 7.5h.01M16 7.5h.01M8 15h.01M12 15h.01M16 15h.01"/></svg>{ar ? 'نطاق التقرير' : 'Report scope'}</span>
                    <select title={ar ? 'يؤثر هذا الاختيار على لوحة الإدارة فقط.' : 'This setting applies to the management dashboard only.'} value={reportScope} onChange={(event) => setReportScope(event.target.value as 'COMPANY' | 'GROUP')}><option value="COMPANY">{ar ? 'الشركة الحالية' : 'Selected company'}</option><option value="GROUP">{ar ? `الشركة وفروعها (${branchOrganizationIds.length})` : `Company and branches (${branchOrganizationIds.length})`}</option></select>
                  </label>}
                </div>
              </div>
            </section>
          </div>

          <nav className="vat-tabs" role="tablist" aria-label={ar ? 'أقسام ضريبة القيمة المضافة' : 'VAT sections'} onKeyDown={handleTabKeyDown}>
            <button id="vat-tab-dashboard" type="button" role="tab" aria-selected={activeTab === 'dashboard'} tabIndex={activeTab === 'dashboard' ? 0 : -1} aria-controls="vat-panel-dashboard" className={activeTab === 'dashboard' ? 'active' : ''} onClick={() => setActiveTab('dashboard')}>
              <strong>{ar ? 'لوحة الإدارة' : 'Management dashboard'}</strong><small>{ar ? 'المبيعات والضريبة والاستحقاق والسيولة' : 'Sales, VAT, deadlines and cash'}</small>
            </button>
            <button id="vat-tab-aggregate" type="button" role="tab" aria-selected={activeTab === 'aggregate'} tabIndex={activeTab === 'aggregate' ? 0 : -1} aria-controls="vat-panel-aggregate" className={activeTab === 'aggregate' ? 'active' : ''} onClick={() => setActiveTab('aggregate')}>
              <strong>{ar ? 'إجماليات الفترة' : 'Period totals'}</strong><small>{ar ? 'إدخال مجمع للمبيعات والمشتريات' : 'Enter aggregated sales and purchases'}</small>
            </button>
            <button
              id="vat-tab-register"
              type="button"
              role="tab"
              aria-selected={activeTab === 'register'}
              tabIndex={activeTab === 'register' ? 0 : -1}
              aria-controls="vat-panel-register"
              className={activeTab === 'register' ? 'active' : ''}
              onClick={() => setActiveTab('register')}
            >
              <strong>{ar ? 'سجل المستندات' : 'Document register'}</strong>
              <small>{ar ? 'تسجيل فواتير المبيعات والمشتريات' : 'Record sales and purchase invoices'}</small>
            </button>
            <button
              id="vat-tab-einvoicing"
              type="button"
              role="tab"
              aria-selected={activeTab === 'einvoicing'}
              tabIndex={activeTab === 'einvoicing' ? 0 : -1}
              aria-controls="vat-panel-einvoicing"
              className={activeTab === 'einvoicing' ? 'active' : ''}
              onClick={() => setActiveTab('einvoicing')}
            >
              <strong>{ar ? 'الفوترة الإلكترونية' : 'E-invoicing'}</strong>
              <small>{ar ? 'متطلبات زاتكا والإعداد والإصدار' : 'ZATCA requirements, setup and issuance'}</small>
            </button>
          </nav>

          <div id="vat-panel-dashboard" role="tabpanel" aria-labelledby="vat-tab-dashboard" hidden={activeTab !== 'dashboard'}>
            {reportScope === 'GROUP' && loadingData ? <div className="vat-loading" role="status">{ar ? 'جارٍ تجميع بيانات الشركة والفروع…' : 'Loading company and branch totals…'}</div> : <VatManagementDashboard
              period={period}
              yearStart={yearStart}
              frequency={profile?.filing_frequency ?? 'QUARTERLY'}
              periodSummary={periodSummary}
              periodTotals={dashboardPeriodTotals}
              annualTotals={dashboardAnnualTotals}
              standardRate={Number(profile?.standard_rate ?? 15)}
              registered={isRegistered}
              ar={ar}
              reportScope={reportScope}
              reportOrganizationCount={reportScope === 'GROUP' ? reportOrganizationIds.length : 1}
              organizationId={organizationId}
              onSaved={() => setInvoiceRefresh((revision) => revision + 1)}
            />}
          </div>

          <div id="vat-panel-aggregate" role="tabpanel" aria-labelledby="vat-tab-aggregate" hidden={activeTab !== 'aggregate'}>
            <VatPeriodSummaryForm
              organizationId={organizationId}
              period={period}
              yearStart={yearStart}
              frequency={profile?.filing_frequency ?? 'QUARTERLY'}
              periodSummary={periodSummary}
              periodTotals={periodTotals}
              annualTotals={annualTotals}
              standardRate={Number(profile?.standard_rate ?? 15)}
              registered={isRegistered}
              ar={ar}
              onSaved={() => setInvoiceRefresh((revision) => revision + 1)}
            />
          </div>

          <div id="vat-panel-register" role="tabpanel" aria-labelledby="vat-tab-register" hidden={activeTab !== 'register'}>
          <section className="vat-panel">
            <div className="vat-panel-head">
              <div><span className="vat-eyebrow">{ar ? 'إدخال يدوي للسجل' : 'MANUAL REGISTER ENTRY'}</span><h2>{ar ? 'تسجيل فاتورة أو مستند ضريبي' : 'Record an invoice or VAT document'}</h2><p>{ar ? 'أدخل بيانات مستند صادر من نظامك المحاسبي لاحتساب ملخص الضريبة. هذا الإدخال لا ينشئ فاتورة إلكترونية ولا يصدرها.' : 'Record invoice data from your accounting system for the VAT summary. This entry does not create or issue an e-invoice.'}</p></div>
            </div>
            <form className="vat-form-grid vat-document-form" onSubmit={addDocument}>
              <label><span>{ar ? 'نوع المستند' : 'Register as'}</span><select value={draft.document_type} onChange={(event) => setDraft({ ...draft, document_type: event.target.value as DocumentDraft['document_type'] })}><option value="SALES">{ar ? 'مبيعات — ضريبة مخرجات' : 'Sales — output VAT'}</option><option value="PURCHASE">{ar ? 'مشتريات — ضريبة مدخلات' : 'Purchases — input VAT'}</option></select></label>
              <label><span>{ar ? 'نوع القيد' : 'Document kind'}</span><select value={draft.document_kind} onChange={(event) => setDraft({ ...draft, document_kind: event.target.value as DocumentDraft['document_kind'] })}><option value="INVOICE">{ar ? 'فاتورة' : 'Invoice'}</option><option value="CREDIT_NOTE">{ar ? 'إشعار دائن' : 'Credit note'}</option></select></label>
              <label><span>{ar ? 'رقم المستند' : 'Document number'}</span><input required maxLength={80} value={draft.document_number} onChange={(event) => setDraft({ ...draft, document_number: event.target.value })} /></label>
              <label><span>{ar ? 'التاريخ الضريبي' : 'Tax date'}</span><input required type="date" value={draft.transaction_date} onChange={(event) => setDraft({ ...draft, transaction_date: event.target.value })} /></label>
              <label><span>{ar ? 'اسم العميل أو المورد' : 'Customer or supplier'}</span><input required maxLength={160} value={draft.counterparty_name} onChange={(event) => setDraft({ ...draft, counterparty_name: event.target.value })} /></label>
              <label><span>{ar ? 'الرقم الضريبي للطرف الآخر (اختياري)' : 'Counterparty VAT number (optional)'}</span><input maxLength={30} value={draft.counterparty_tax_number} onChange={(event) => setDraft({ ...draft, counterparty_tax_number: event.target.value })} /></label>
              <label><span>{ar ? 'تصنيف التوريد' : 'Supply category'}</span><select value={draft.supply_type} onChange={(event) => setDraft({ ...draft, supply_type: event.target.value as DocumentDraft['supply_type'] })}><option value="STANDARD">{ar ? `خاضع للنسبة الأساسية (${currentTaxRate}%)` : `Standard rated (${currentTaxRate}%)`}</option><option value="ZERO_RATED">{ar ? 'خاضع للنسبة الصفرية' : 'Zero-rated'}</option><option value="EXEMPT">{ar ? 'معفى' : 'Exempt'}</option><option value="OUT_OF_SCOPE">{ar ? 'خارج النطاق' : 'Out of scope'}</option></select></label>
              <label><span>{ar ? 'صافي المبلغ (ريال)' : 'Net amount (SAR)'}</span><input required type="number" min="0.01" step="0.01" value={draft.net_amount} onChange={(event) => setDraft({ ...draft, net_amount: event.target.value })} /></label>
              {draft.document_type === 'PURCHASE' && <label><span>{ar ? 'نسبة ضريبة المدخلات القابلة للخصم (%)' : 'Recoverable input VAT (%)'}</span><input required type="number" min="0" max="100" step="0.01" value={draft.recoverable_percent} onChange={(event) => setDraft({ ...draft, recoverable_percent: event.target.value })} /></label>}
              <label className="vat-notes-field"><span>{ar ? 'ملاحظات' : 'Notes'}</span><input maxLength={1000} value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} /></label>
              <div className="vat-tax-preview"><span>{ar ? 'الضريبة المحسوبة' : 'Calculated VAT'} <strong>{money(previewTax)} SAR</strong></span><span>{ar ? 'الإجمالي' : 'Gross total'} <strong>{money(Number(draft.net_amount || 0) + previewTax)} SAR</strong></span></div>
              <button className="vat-button primary vat-submit" disabled={saving || !isRegistered}>{saving ? (ar ? 'جارٍ الحفظ…' : 'Saving…') : (ar ? 'إضافة إلى السجل' : 'Add to register')}</button>
            </form>
          </section>

          <section className="vat-panel">
            <div className="vat-panel-head vat-register-heading">
              <div><h2>{ar ? 'مستندات الفترة' : 'Documents in this period'}</h2><p>{loadingData ? (ar ? 'جارٍ تحديث السجل…' : 'Refreshing register…') : `${documents.length} ${ar ? 'مستند' : 'documents'}`}</p></div>
              <span className="vat-period-chip">{period.from} — {period.to}</span>
            </div>
            <div className="vat-table-wrap"><table className="vat-table">
              <thead><tr><th>{ar ? 'التاريخ' : 'Date'}</th><th>{ar ? 'النوع' : 'Type'}</th><th>{ar ? 'رقم المستند' : 'Document'}</th><th>{ar ? 'العميل / المورد' : 'Counterparty'}</th><th>{ar ? 'التصنيف' : 'Supply'}</th><th>{ar ? 'الصافي' : 'Net'}</th><th>{ar ? 'الضريبة' : 'VAT'}</th><th>{ar ? 'الإجمالي' : 'Gross'}</th><th>{ar ? 'إجراء' : 'Action'}</th></tr></thead>
              <tbody>
                {documents.map((document) => <tr key={document.id}>
                  <td>{document.transaction_date}</td><td><span className={`vat-type-pill ${document.document_type.toLowerCase()}`}>{document.document_type === 'SALES' ? (ar ? 'مبيعات' : 'Sales') : (ar ? 'مشتريات' : 'Purchase')}</span><small>{document.is_einvoice ? (ar ? 'فاتورة إلكترونية صادرة' : 'Issued e-invoice') : document.document_kind === 'CREDIT_NOTE' ? (ar ? 'إشعار دائن' : 'Credit note') : ''}</small></td>
                  <td><strong>{document.document_number}</strong></td><td>{document.counterparty_name}</td><td>{supplyLabel(document.supply_type, ar)}</td><td>{document.document_kind === 'CREDIT_NOTE' ? '−' : ''}{money(document.net_amount)} SAR</td><td>{document.document_kind === 'CREDIT_NOTE' ? '−' : ''}{money(document.tax_amount)} SAR</td><td>{document.document_kind === 'CREDIT_NOTE' ? '−' : ''}{money(document.gross_amount)} SAR</td><td>{document.is_einvoice ? <span className="vat-field-hint">{ar ? 'تدار من سجل الفواتير' : 'Manage in invoice register'}</span> : <button type="button" className="vat-delete" onClick={() => void deleteDocument(document.id)} disabled={saving} aria-label={ar ? `حذف ${document.document_number}` : `Delete ${document.document_number}`}>×</button>}</td>
                </tr>)}
                {!documents.length && <tr><td colSpan={9} className="vat-empty-row">{loadingData ? (ar ? 'جارٍ التحميل…' : 'Loading…') : (ar ? 'لا توجد مستندات مسجلة لهذه الفترة.' : 'No VAT documents have been recorded for this period.')}</td></tr>}
              </tbody>
            </table></div>
          </section>

          <p className="vat-disclaimer">{ar ? 'تتضمن الملخصات الفواتير الصادرة المسجلة هنا. لا ترسل هذه الشاشة الإقرار إلى هيئة الزكاة والضريبة والجمارك، وإصدار QR للمرحلة الأولى لا يغني عن تكامل المرحلة الثانية عند انطباقه. راجع التصنيف الضريبي ومواعيد الإقرار قبل التقديم.' : 'Summaries include invoices issued here. This screen does not submit returns to ZATCA, and Phase 1 QR issuance does not replace Phase 2 integration when applicable. Review tax treatment and filing dates before submission.'}</p>
          </div>
          <div id="vat-panel-einvoicing" role="tabpanel" aria-labelledby="vat-tab-einvoicing" hidden={activeTab !== 'einvoicing'}>
            <section className="vat-panel vat-einvoice-overview">
              <div>
                <span className="vat-eyebrow">{ar ? 'مساحة مستقلة لاستكمال المتطلبات' : 'SEPARATE WORKSPACE FOR REQUIREMENTS'}</span>
                <h2>{ar ? 'إدارة الفاتورة الإلكترونية' : 'Electronic invoice management'}</h2>
                <p>{ar ? 'هنا تُدار متطلبات الفوترة الإلكترونية وإعداد زاتكا ومسودة الفاتورة وإصدار QR. هذا المسار منفصل عن إدخال الفواتير المستخدم لاحتساب ملخص الضريبة.' : 'Manage e-invoicing requirements, ZATCA setup, invoice drafts and QR issuance here. This workflow is separate from the invoice register used for VAT summaries.'}</p>
              </div>
              <span className="vat-status pending">{ar ? 'استكمال المتطلبات قيد العمل' : 'Requirements review in progress'}</span>
              <div className="vat-einvoice-steps" aria-label={ar ? 'آلية العمل' : 'Workflow'}>
                <span><b>1</b>{ar ? 'إعداد بيانات الوحدة' : 'Set up the invoice unit'}</span>
                <span><b>2</b>{ar ? 'إدخال الفاتورة ومراجعتها' : 'Enter and review the invoice'}</span>
                <span><b>3</b>{ar ? 'اختبار المتطلبات والربط' : 'Validate requirements and integration'}</span>
              </div>
            </section>
            {organizationId && <VatEInvoiceSetup
              key={organizationId}
              organizationId={organizationId}
              organizationName={selectedOrganization?.name ?? ''}
              vatNumber={profile?.tax_registration_number ?? ''}
              registered={isRegistered}
              ar={ar}
            />}
            {organizationId && <VatEInvoiceRegister
              key={`invoices-${organizationId}`}
              organizationId={organizationId}
              organizationName={selectedOrganization?.name ?? ''}
              vatNumber={profile?.tax_registration_number ?? ''}
              registered={isRegistered}
              ar={ar}
              onInvoiceIssued={() => setInvoiceRefresh((revision) => revision + 1)}
            />}
          </div>
        </>
      )}
    </main>
  );
}

function Metric({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) {
  return <div className={`vat-metric ${emphasis ? 'emphasis' : ''}`}><span>{label}</span><strong>{value}</strong></div>;
}

function emptyTotals(): VatDashboardTotals {
  return {
    salesBase: '0', salesGross: '0', purchaseBase: '0', purchaseVatBeforeRecovery: '0',
    outputTax: '0', inputTax: '0', taxPayable: '0', taxCredit: '0', salesNet: '0', purchaseNet: '0',
    paidAmount: '0', cashReservedAmount: '0', filingStatus: 'NOT_FILED', dueDate: '',
    zeroRatedSales: '0', exemptSales: '0', outOfScopeSales: '0',
  };
}

function money(value: string | number) {
  return Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function frequencyLabel(frequency: VatFilingFrequency, ar: boolean) {
  return frequency === 'MONTHLY' ? (ar ? 'شهري' : 'Monthly') : (ar ? 'ربع سنوي' : 'Quarterly');
}

function registrationLabel(status: VatProfile['registration_status'], ar: boolean) {
  const labels = {
    NOT_REGISTERED: ar ? 'غير مسجل' : 'Not registered',
    REGISTERED: ar ? 'مسجل' : 'Registered',
    PENDING: ar ? 'قيد الإجراء' : 'Pending',
    DEREGISTERED: ar ? 'ملغى' : 'Deregistered',
  };
  return labels[status];
}

function supplyLabel(supply: VatDocument['supply_type'], ar: boolean) {
  const labels = {
    STANDARD: ar ? 'أساسي' : 'Standard',
    ZERO_RATED: ar ? 'صفري' : 'Zero-rated',
    EXEMPT: ar ? 'معفى' : 'Exempt',
    OUT_OF_SCOPE: ar ? 'خارج النطاق' : 'Out of scope',
  };
  return labels[supply];
}

function monthLabel(month: number, ar: boolean) {
  const namesAr = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  const namesEn = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return (ar ? namesAr : namesEn)[month - 1];
}

function messageFor(code: string, ar: boolean) {
  const labels: Record<string, [string, string]> = {
    UNAUTHORIZED: ['يلزم تسجيل الدخول.', 'Please sign in.'],
    ORGANIZATION_ACCESS_REQUIRED: ['ليس لديك صلاحية الوصول إلى هذه المؤسسة.', 'You do not have access to this organization.'],
    ORGANIZATION_ADMIN_REQUIRED: ['إدارة الملف الضريبي متاحة لمالك المؤسسة أو مديرها.', 'Only organization owners and admins can manage VAT data.'],
    VAT_REGISTRATION_NUMBER_REQUIRED: ['أدخل رقم التسجيل الضريبي للمؤسسة المسجلة.', 'Enter the VAT number for a registered organization.'],
    VAT_REGISTRATION_REQUIRED: ['يجب حفظ حالة التسجيل كـ «مسجل» قبل إضافة المستندات.', 'Mark the organization as registered before adding documents.'],
    VAT_PROFILE_REQUIRED: ['احفظ ملف التسجيل أولًا.', 'Save the VAT registration profile first.'],
    VAT_DOCUMENT_NUMBER_EXISTS: ['رقم المستند مستخدم من قبل ضمن هذا النوع.', 'This document number already exists for this document type.'],
    INVALID_PERIOD_MONTH: ['اختر شهرًا صحيحًا للفترة.', 'Choose a valid period month.'],
  };
  return labels[code]?.[ar ? 0 : 1] ?? code;
}
