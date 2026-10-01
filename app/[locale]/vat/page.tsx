'use client';

import { FormEvent, KeyboardEvent, use, useEffect, useMemo, useState } from 'react';
import Decimal from 'decimal.js';
import { getVatPeriod, type VatFilingFrequency } from '@/lib/vat-period';
import { summarizeVatDocuments, type VatDocumentForSummary } from '@/lib/vat';
import { organizationDisplayName } from '@/lib/organization-display';
import { VatEInvoiceSetup } from '@/components/vat-einvoice-setup';
import { VatEInvoiceRegister } from '@/components/vat-einvoice-register';
import { VatManagementDashboard, VatPeriodSummaryForm, type VatMonthlyTrendPoint, type VatUpcomingObligation } from '@/components/vat-period-workspace';
import { VatContactPicker, type VatContact } from '@/components/vat-contact-picker';
import type { VatPeriodSummaryRecord } from '@/lib/vat-period-summary';
import { aggregateVatDashboardTotals, type VatDashboardTotals } from '@/lib/vat-dashboard-summary';
import { calculateVatDocumentLines } from '@/lib/vat-document-lines';
import { prepareVatAccountingEntryLines } from '@/lib/vat-accounting-entry';
import { resolveVatExchangeRate, type VatFxRate } from '@/lib/vat-invoice-currency';
import './vat.css';

type Organization = {
  id: string;
  name: string;
  organization_kind?: 'HOLDING' | 'SUBSIDIARY';
  parent_organization_id?: string | null;
  sort_order?: number;
  base_currency?: string;
};

type VatCurrency = { code: string; name_ar: string; name_en: string; symbol: string | null; decimals: number };

type VatProfile = {
  id: string;
  organization_id: string;
  tax_registration_number: string | null;
  registration_status: 'NOT_REGISTERED' | 'REGISTERED' | 'PENDING' | 'DEREGISTERED';
  registration_date: string | null;
  filing_frequency: VatFilingFrequency;
  standard_rate: number;
  period_start_month: number;
  registered_name: string | null;
  seller_street: string | null;
  seller_building_number: string | null;
  seller_district: string | null;
  seller_additional_number: string | null;
  seller_city: string | null;
  seller_postal_code: string | null;
};

type VatDocument = VatDocumentForSummary & {
  id: string;
  document_number: string;
  transaction_date: string;
  counterparty_name: string;
  counterparty_tax_number?: string | null;
  document_type: 'SALES' | 'PURCHASE';
  document_kind: 'INVOICE' | 'CREDIT_NOTE';
  line_items?: Array<{ supply_type: 'STANDARD' | 'ZERO_RATED' | 'EXEMPT' | 'OUT_OF_SCOPE' }> | null;
  supply_type: 'STANDARD' | 'ZERO_RATED' | 'EXEMPT' | 'OUT_OF_SCOPE';
  tax_rate: number;
  tax_amount: number;
  gross_amount: number;
  currency?: string;
  source_currency?: string;
  exchange_rate?: string | number;
  source_net_amount?: string | number;
  source_tax_amount?: string | number;
  source_gross_amount?: string | number;
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
  registered_name: string;
  seller_street: string;
  seller_building_number: string;
  seller_district: string;
  seller_additional_number: string;
  seller_city: string;
  seller_postal_code: string;
};

type DocumentDraft = {
  document_type: 'SALES' | 'PURCHASE';
  document_kind: 'INVOICE' | 'CREDIT_NOTE';
  document_number: string;
  transaction_date: string;
  counterparty_name: string;
  counterparty_tax_number: string;
  counterparty_contact_id: string;
  supply_type: 'STANDARD' | 'ZERO_RATED' | 'EXEMPT' | 'OUT_OF_SCOPE';
  net_amount: string;
  recoverable_percent: string;
  notes: string;
};

type DocumentLineDraft = {
  description: string;
  unit: string;
  quantity: string;
  unit_price: string;
  discount_amount: string;
  discount_mode: 'AMOUNT' | 'PERCENT';
  supply_type: DocumentDraft['supply_type'];
};

type ApiData = {
  profile: VatProfile | null;
  period: { from: string; to: string };
  yearStart: string;
  periodSummary: VatPeriodSummaryRecord | null;
  periodTotals: VatDashboardTotals;
  annualTotals: VatDashboardTotals;
  documents: VatDocument[];
  service_catalog?: string[];
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
  registered_name: '',
  seller_street: '',
  seller_building_number: '',
  seller_district: '',
  seller_additional_number: '',
  seller_city: '',
  seller_postal_code: '',
};
const emptyDocument = (): DocumentDraft => ({
  document_type: 'SALES',
  document_kind: 'INVOICE',
  document_number: '',
  transaction_date: new Date().toISOString().slice(0, 10),
  counterparty_name: '',
  counterparty_tax_number: '',
  counterparty_contact_id: '',
  supply_type: 'STANDARD',
  net_amount: '',
  recoverable_percent: '100',
  notes: '',
});
const emptyDocumentLine = (): DocumentLineDraft => ({ description: '', unit: '', quantity: '1', unit_price: '', discount_amount: '0', discount_mode: 'AMOUNT', supply_type: 'STANDARD' });

export default function VatManagement({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ section?: string | string[] }> }) {
  const { locale } = use(params);
  const { section } = use(searchParams);
  const requestedSection = Array.isArray(section) ? section[0] : section;
  const initialTab = requestedSection === 'invoices' ? 'register' : requestedSection === 'einvoicing' ? 'einvoicing' : requestedSection === 'aggregate' ? 'aggregate' : 'dashboard';
  const ar = locale === 'ar';
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [organizationId, setOrganizationId] = useState('');
  const [periodMonth, setPeriodMonth] = useState(currentMonth);
  const [reportYear, setReportYear] = useState(() => Number(currentMonth().slice(0, 4)));
  const [reportFrequency, setReportFrequency] = useState<VatFilingFrequency>('QUARTERLY');
  const [reportFrequencyTouched, setReportFrequencyTouched] = useState(false);
  const [profile, setProfile] = useState<VatProfile | null>(null);
  const [profileDraft, setProfileDraft] = useState<VatProfileDraft>(emptyProfile);
  const [documents, setDocuments] = useState<VatDocument[]>([]);
  const [period, setPeriod] = useState(() => getVatPeriod(currentMonth(), 'QUARTERLY'));
  const reportPeriod = useMemo(() => getVatPeriod(periodMonth, reportFrequency, 1), [periodMonth, reportFrequency]);
  const [yearStart, setYearStart] = useState(`${new Date().getFullYear()}-01-01`);
  const [periodSummary, setPeriodSummary] = useState<VatPeriodSummaryRecord | null>(null);
  const [periodTotals, setPeriodTotals] = useState<VatDashboardTotals>(emptyTotals());
  const [annualTotals, setAnnualTotals] = useState<VatDashboardTotals>(emptyTotals());
  const [reportScope, setReportScope] = useState<'COMPANY' | 'GROUP'>('COMPANY');
  const [branchVatData, setBranchVatData] = useState<ApiData[]>([]);
  const [monthlyTrend, setMonthlyTrend] = useState<VatMonthlyTrendPoint[]>([]);
  const [monthlyTrendLoading, setMonthlyTrendLoading] = useState(false);
  const [loadingOrganizations, setLoadingOrganizations] = useState(true);
  const [loadingData, setLoadingData] = useState(false);
  const [saving, setSaving] = useState(false);
  const [invoiceRefresh, setInvoiceRefresh] = useState(0);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileDetailsOpen, setProfileDetailsOpen] = useState(false);
  const [periodDetailsOpen, setPeriodDetailsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'aggregate' | 'register' | 'einvoicing'>(initialTab);
  const [registerDirection, setRegisterDirection] = useState<'SALES' | 'PURCHASE'>('SALES');
  const [salesEntryMode, setSalesEntryMode] = useState<'ACCOUNTING' | 'ZAKATFLOW'>('ACCOUNTING');
  const [registerFormOpen, setRegisterFormOpen] = useState(false);
  const [registerAddMenuOpen, setRegisterAddMenuOpen] = useState(false);
  const [registerSearch, setRegisterSearch] = useState('');
  const [registerKindFilter, setRegisterKindFilter] = useState<'ALL' | 'INVOICE' | 'CREDIT_NOTE'>('ALL');
  const [registerSourceFilter, setRegisterSourceFilter] = useState<'ALL' | 'EINVOICE' | 'ACCOUNTING'>('ALL');
  const [draft, setDraft] = useState<DocumentDraft>(emptyDocument);
  const [accountingLines, setAccountingLines] = useState<DocumentLineDraft[]>([emptyDocumentLine()]);
  const [currencies, setCurrencies] = useState<VatCurrency[]>([]);
  const [fxRates, setFxRates] = useState<VatFxRate[]>([]);
  const [invoiceCurrency, setInvoiceCurrency] = useState('SAR');
  const [exchangeRate, setExchangeRate] = useState('1');
  const [accountingPriceDisplay, setAccountingPriceDisplay] = useState<'UNIT' | 'LINE'>('UNIT');
  const [accountingDiscountMode, setAccountingDiscountMode] = useState<'NONE' | 'AMOUNT' | 'PERCENT'>('AMOUNT');
  const [accountingPricesIncludeVat, setAccountingPricesIncludeVat] = useState(false);
  const [showAccountingFields, setShowAccountingFields] = useState(false);
  const [showAccountingUnits, setShowAccountingUnits] = useState(false);
  const [serviceCatalog, setServiceCatalog] = useState<string[]>([]);
  const [serviceAddForIndex, setServiceAddForIndex] = useState<number | null>(null);
  const [serviceNameDraft, setServiceNameDraft] = useState('');
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const sortedOrganizations = useMemo(
    () => [...organizations].sort((a, b) => Number(a.sort_order ?? 100) - Number(b.sort_order ?? 100) || a.name.localeCompare(b.name)),
    [organizations],
  );
  const selectedOrganization = organizations.find((organization) => organization.id === organizationId);
  const isOfficialFilingPeriod = Boolean(profile
    && profile.filing_frequency === reportFrequency
    && getVatPeriod(periodMonth, profile.filing_frequency, Number(profile.period_start_month ?? 1)).from === reportPeriod.from
    && getVatPeriod(periodMonth, profile.filing_frequency, Number(profile.period_start_month ?? 1)).to === reportPeriod.to);
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
  const usesAccountingLines = registerDirection === 'PURCHASE' || salesEntryMode === 'ACCOUNTING';
  const currentTaxRate = Number(profile?.standard_rate ?? profileDraft.standard_rate ?? 15);
  const baseCurrency = (selectedOrganization?.base_currency || 'SAR').toUpperCase();
  const isForeignCurrency = invoiceCurrency !== baseCurrency;
  const resolvedRate = isForeignCurrency ? Number(exchangeRate) : 1;
  const currencyName = (code: string) => {
    const currency = currencies.find((item) => item.code === code);
    return currency ? `${currency.code} — ${ar ? currency.name_ar : currency.name_en}` : code;
  };
  const displayInvoiceAmount = (value: string | number, code: string) => `${money(value)} ${code}`;
  const accountingLineTotals = useMemo(() => {
    let lines: Array<ReturnType<typeof calculateVatDocumentLines>['lines'][number] | null>;
    try {
      lines = calculateVatDocumentLines(prepareVatAccountingEntryLines(accountingLines.map((line) => ({
        ...line,
        description: line.description.trim() || '—',
      })), {
        standardRate: currentTaxRate,
        priceDisplay: accountingPriceDisplay,
        discountMode: accountingDiscountMode,
        pricesIncludeVat: accountingPricesIncludeVat,
      }), currentTaxRate).lines;
    } catch {
      lines = accountingLines.map(() => null);
    }
    const sum = (key: 'net_amount' | 'tax_amount' | 'gross_amount') => lines
      .reduce((total, line) => total.add(line?.[key] ?? 0), new Decimal(0))
      .toFixed(2);
    return { lines, netAmount: sum('net_amount'), taxAmount: sum('tax_amount'), grossAmount: sum('gross_amount') };
  }, [accountingLines, currentTaxRate, accountingDiscountMode, accountingPriceDisplay, accountingPricesIncludeVat]);
  const accountingBaseTotals = useMemo(() => {
    if (!Number.isFinite(resolvedRate) || resolvedRate <= 0) return null;
    const sumBase = (key: 'net_amount' | 'tax_amount' | 'gross_amount') => accountingLineTotals.lines
      .reduce((total, line) => total.add(new Decimal(line?.[key] ?? 0).mul(resolvedRate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP)), new Decimal(0))
      .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
      .toFixed(2);
    return { netAmount: sumBase('net_amount'), taxAmount: sumBase('tax_amount'), grossAmount: sumBase('gross_amount') };
  }, [accountingLineTotals, resolvedRate]);
  const registerDocuments = useMemo(() => documents.filter((document) => document.document_type === registerDirection), [documents, registerDirection]);
  const filteredRegisterDocuments = registerDocuments.filter((document) => {
    const query = registerSearch.trim().toLocaleLowerCase();
    const matchesSearch = !query || document.counterparty_name.toLocaleLowerCase().includes(query) || document.document_number.toLocaleLowerCase().includes(query);
    const matchesKind = registerKindFilter === 'ALL' || document.document_kind === registerKindFilter;
    const matchesSource = registerSourceFilter === 'ALL'
      || (registerSourceFilter === 'EINVOICE' ? document.is_einvoice : !document.is_einvoice);
    return matchesSearch && matchesKind && matchesSource;
  });
  const registerSummary = useMemo(() => registerDocuments.reduce((totals, document) => {
    const sign = document.document_kind === 'CREDIT_NOTE' ? -1 : 1;
    return {
      net: totals.net.add(new Decimal(document.net_amount).mul(sign)),
      tax: totals.tax.add(new Decimal(document.tax_amount).mul(sign)),
      gross: totals.gross.add(new Decimal(document.gross_amount).mul(sign)),
    };
  }, { net: new Decimal(0), tax: new Decimal(0), gross: new Decimal(0) }), [registerDocuments]);
  const previewTax = draft.supply_type === 'STANDARD'
    ? (Number(draft.net_amount || 0) * currentTaxRate / 100)
    : 0;

  useEffect(() => { setActiveTab(initialTab); }, [initialTab]);

  function selectTab(tab: 'dashboard' | 'aggregate' | 'register' | 'einvoicing') {
    setActiveTab(tab);
    const url = new URL(window.location.href);
    url.searchParams.set('section', tab === 'register' ? 'invoices' : tab);
    window.history.replaceState(null, '', url.toString());
  }

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
    selectTab(nextTab);
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
    let active = true;
    fetch('/api/currencies')
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body?.error || `HTTP_${response.status}`);
        return body as VatCurrency[];
      })
      .then((rows) => { if (active) setCurrencies(rows); })
      .catch((error) => { if (active) setNotice({ kind: 'error', text: messageFor(error.message, ar) }); });
    return () => { active = false; };
  }, [ar]);

  useEffect(() => {
    if (!organizationId) { setFxRates([]); return; }
    let active = true;
    fetch(`/api/fx?organization_id=${encodeURIComponent(organizationId)}`)
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body?.error || `HTTP_${response.status}`);
        return body as VatFxRate[];
      })
      .then((rows) => { if (active) setFxRates(rows); })
      .catch((error) => { if (active) setNotice({ kind: 'error', text: messageFor(error.message, ar) }); });
    return () => { active = false; };
  }, [organizationId, ar]);

  useEffect(() => {
    if (!selectedOrganization) return;
    setInvoiceCurrency((selectedOrganization.base_currency || 'SAR').toUpperCase());
    setExchangeRate('1');
  }, [organizationId, selectedOrganization?.base_currency]);

  useEffect(() => {
    const rate = resolveVatExchangeRate(fxRates, invoiceCurrency, baseCurrency, draft.transaction_date);
    setExchangeRate(rate ?? '');
  }, [fxRates, invoiceCurrency, baseCurrency, draft.transaction_date]);

  useEffect(() => {
    if (!organizationId) { setServiceCatalog([]); return; }
    try {
      const stored = window.localStorage.getItem(`vat-service-catalog:${organizationId}`);
      const parsed: unknown = stored ? JSON.parse(stored) : [];
      setServiceCatalog(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []);
    } catch {
      setServiceCatalog([]);
    }
  }, [organizationId]);

  function addServiceToCatalog() {
    const name = serviceNameDraft.trim();
    if (!name || serviceAddForIndex === null) return;
    const next = serviceCatalog.some((item) => item.toLocaleLowerCase() === name.toLocaleLowerCase())
      ? serviceCatalog
      : [...serviceCatalog, name];
    setServiceCatalog(next);
    try { window.localStorage.setItem(`vat-service-catalog:${organizationId}`, JSON.stringify(next)); } catch { /* Keep the current session usable if browser storage is unavailable. */ }
    setAccountingLines((lines) => lines.map((line, index) => index === serviceAddForIndex ? { ...line, description: name } : line));
    setServiceAddForIndex(null);
    setServiceNameDraft('');
  }

  useEffect(() => {
    if (!organizationId) return;
    let active = true;
    setLoadingData(true);
    setBranchVatData([]);
    const reportMonths = monthsInRange(reportPeriod.from, reportPeriod.to);
    const load = async (id: string, month: string): Promise<ApiData> => {
      const response = await fetch(`/api/vat?organization_id=${encodeURIComponent(id)}&period_month=${encodeURIComponent(month)}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || `HTTP_${response.status}`);
      return body as ApiData;
    };
    Promise.all([
      Promise.all(reportMonths.map((month) => load(organizationId, month))),
      reportScope === 'GROUP'
        ? Promise.all(branchOrganizationIds.map((id) => Promise.all(reportMonths.map((month) => load(id, month)))))
        : Promise.resolve([] as ApiData[][]),
    ])
      .then(([entityRows, branchRows]) => {
        if (!active) return;
        const body = combineReportData(entityRows, reportPeriod);
        const branches = branchRows.map((rows) => combineReportData(rows, reportPeriod));
        if (body.profile && !reportFrequencyTouched) setReportFrequency(body.profile.filing_frequency);
        setProfile(body.profile);
        setDocuments(body.documents);
        setServiceCatalog((current) => {
          const merged = Array.from(new Set([...current, ...(body.service_catalog ?? [])]));
          try { window.localStorage.setItem(`vat-service-catalog:${organizationId}`, JSON.stringify(merged)); } catch { /* Server-backed service choices remain available for this session. */ }
          return merged;
        });
        setPeriod(reportPeriod);
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
          registered_name: body.profile.registered_name ?? organizations.find((organization) => organization.id === organizationId)?.name ?? '',
          seller_street: body.profile.seller_street ?? '',
          seller_building_number: body.profile.seller_building_number ?? '',
          seller_district: body.profile.seller_district ?? '',
          seller_additional_number: body.profile.seller_additional_number ?? '',
          seller_city: body.profile.seller_city ?? '',
          seller_postal_code: body.profile.seller_postal_code ?? '',
        } : { ...emptyProfile, registered_name: organizations.find((organization) => organization.id === organizationId)?.name ?? '' });
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
  }, [organizationId, periodMonth, reportFrequency, reportPeriod.from, reportPeriod.to, reportFrequencyTouched, ar, invoiceRefresh, reportScope, branchOrganizationKey]);

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
  const upcomingObligations = useMemo<VatUpcomingObligation[]>(() => {
    if (!isOfficialFilingPeriod) return [];
    const sources = reportScope === 'GROUP'
      ? [
        { id: organizationId, name: selectedOrganization?.name, period, totals: periodTotals },
        ...branchVatData.map((branch, index) => ({
          id: branchOrganizationIds[index] ?? `branch-${index}`,
          name: organizations.find((organization) => organization.id === branchOrganizationIds[index])?.name,
          period: branch.period,
          totals: branch.periodTotals,
        })),
      ]
      : [{ id: organizationId, name: selectedOrganization?.name, period, totals: periodTotals }];
    return sources.map((source) => {
      const amountDue = Math.max(0, Number(source.totals.taxPayable) - Number(source.totals.paidAmount));
      const dueDate = source.totals.dueDate ?? source.period.to;
      if (!amountDue || !dueDate) return null;
      return {
        id: source.id,
        organizationName: source.name ? organizationDisplayName(source.name, ar) : (ar ? 'الجهة المحددة' : 'Selected entity'),
        dueDate,
        outstandingAmount: amountDue.toFixed(2),
      };
    }).filter((row): row is VatUpcomingObligation => row !== null).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  }, [isOfficialFilingPeriod, reportScope, organizationId, selectedOrganization?.name, period, periodTotals, branchVatData, branchOrganizationIds, organizations, ar]);

  useEffect(() => {
    if (!organizationId || !period.from || !period.to) { setMonthlyTrend([]); return; }
    let active = true;
    const months = monthsInRange(period.from, period.to);
    const entityIds = reportScope === 'GROUP' ? reportOrganizationIds : [organizationId];
    setMonthlyTrendLoading(true);
    Promise.all(months.map(async (month) => {
      const entities = await Promise.all(entityIds.map(async (id) => {
        const response = await fetch(`/api/vat?organization_id=${encodeURIComponent(id)}&period_month=${encodeURIComponent(month)}`);
        const body = await response.json();
        if (!response.ok) throw new Error(body?.error || `HTTP_${response.status}`);
        const data = body as ApiData;
        const seen = new Set<string>();
        return data.documents.filter((document) => {
          const key = document.id || `${document.document_type}:${document.document_number}:${document.transaction_date}`;
          if (!document.transaction_date.startsWith(month) || seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      }));
      let outputTax = new Decimal(0);
      let inputTax = new Decimal(0);
      for (const document of entities.flat()) {
        const sign = document.document_kind === 'CREDIT_NOTE' ? -1 : 1;
        const tax = new Decimal(document.tax_amount || 0).mul(sign);
        if (document.document_type === 'SALES') outputTax = outputTax.add(tax);
        else inputTax = inputTax.add(tax.mul(document.recoverable_percent || 0).div(100));
      }
      return { month, outputTax: outputTax.toFixed(2), inputTax: inputTax.toFixed(2) };
    })).then((rows) => { if (active) setMonthlyTrend(rows); })
      .catch(() => { if (active) setMonthlyTrend([]); })
      .finally(() => { if (active) setMonthlyTrendLoading(false); });
    return () => { active = false; };
  }, [organizationId, period.from, period.to, reportScope, reportOrganizationIds]);

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
          registered_name: profileDraft.registered_name.trim() || null,
          seller_street: profileDraft.seller_street.trim() || null,
          seller_building_number: profileDraft.seller_building_number.trim() || null,
          seller_district: profileDraft.seller_district.trim() || null,
          seller_additional_number: profileDraft.seller_additional_number.trim() || null,
          seller_city: profileDraft.seller_city.trim() || null,
          seller_postal_code: profileDraft.seller_postal_code.trim() || null,
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
      const usesInvoiceLines = usesAccountingLines;
      if (usesInvoiceLines && isForeignCurrency && (!Number.isFinite(resolvedRate) || resolvedRate <= 0)) {
        throw new Error('VAT_EXCHANGE_RATE_REQUIRED');
      }
      const lineCalculation = usesInvoiceLines ? calculateVatDocumentLines(prepareVatAccountingEntryLines(accountingLines, {
        standardRate: currentTaxRate,
        priceDisplay: accountingPriceDisplay,
        discountMode: accountingDiscountMode,
        pricesIncludeVat: accountingPricesIncludeVat,
      }), currentTaxRate) : null;
      const response = await fetch('/api/vat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add_document',
          organization_id: organizationId,
          ...draft,
          supply_type: lineCalculation?.lines[0]?.supply_type ?? draft.supply_type,
          net_amount: Number(lineCalculation?.netAmount ?? draft.net_amount),
          lines: lineCalculation?.lines.map((line, index) => ({ description: line.description, unit: accountingLines[index]?.unit || undefined, quantity: line.quantity, unit_price: line.unit_price, discount_amount: line.discount_amount, supply_type: line.supply_type })),
          currency: usesInvoiceLines ? invoiceCurrency : baseCurrency,
          exchange_rate: usesInvoiceLines ? resolvedRate : 1,
          recoverable_percent: draft.document_type === 'PURCHASE' ? Number(draft.recoverable_percent) : 100,
          counterparty_contact_id: draft.counterparty_contact_id || null,
          counterparty_tax_number: draft.counterparty_tax_number.trim() || null,
          notes: draft.notes.trim() || null,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || `HTTP_${response.status}`);
      setDraft({ ...emptyDocument(), document_type: registerDirection });
      setAccountingLines([emptyDocumentLine()]);
      setRegisterFormOpen(false);
      setRegisterAddMenuOpen(false);
      setNotice({ kind: 'success', text: ar ? 'تم تسجيل المستند الضريبي.' : 'VAT document recorded.' });
      await reloadData();
    } catch (error: any) {
      setNotice({ kind: 'error', text: messageFor(error.message, ar) });
    } finally {
      setSaving(false);
    }
  }

  function startRegisterEntry(kind: DocumentDraft['document_kind']) {
    setDraft({ ...emptyDocument(), document_type: registerDirection, document_kind: kind });
    setAccountingLines([emptyDocumentLine()]);
    setRegisterFormOpen(true);
    setRegisterAddMenuOpen(false);
    setNotice(null);
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
    setInvoiceRefresh((revision) => revision + 1);
  }

  const isRegistered = profile?.registration_status === 'REGISTERED';

  return (
    <main className="container vat-page" dir={ar ? 'rtl' : 'ltr'}>
      <header className="vat-header">
        <div>
          <span className="vat-eyebrow">{ar ? 'الضرائب والفوترة' : 'TAX & INVOICING'}</span>
          <h1>{ar ? 'إدارة الضرائب والفوترة' : 'Tax & invoicing management'}</h1>
          <p>{ar ? 'مساحة موحدة لإدارة ضريبة القيمة المضافة، وفواتير المبيعات والمشتريات، ومتطلبات الفوترة الإلكترونية.' : 'A unified workspace for VAT, sales and purchase invoices, and e-invoicing requirements.'}</p>
        </div>
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
          <section className="vat-report-toolbar" aria-label={ar ? 'مرشحات تقرير الضرائب' : 'Tax report filters'}>
            <label className="vat-report-filter vat-report-organization">
              <span className="vat-filter-label">{ar ? 'الشركة أو المؤسسة' : 'Company or organization'}</span>
              <select value={organizationId} onChange={(event) => { setOrganizationId(event.target.value); setReportScope('COMPANY'); }} disabled={loadingOrganizations || organizations.length === 0}>
                {sortedOrganizations.map((organization) => <option key={organization.id} value={organization.id}>{organizationDisplayName(organization.name, ar)}</option>)}
              </select>
            </label>
            <div className="vat-report-filter vat-report-period-filter">
              <span className="vat-filter-label">{ar ? 'الفترة الضريبية' : 'Tax period'}</span>
              <div className="vat-report-period-controls">
                <div className="vat-report-frequency-toggle" role="group" aria-label={ar ? 'دورية التقرير' : 'Report frequency'}>
                  {(['MONTHLY', 'QUARTERLY'] as const).map((frequency) => <button type="button" key={frequency} className={reportFrequency === frequency ? 'active' : ''} aria-pressed={reportFrequency === frequency} onClick={() => { setReportFrequencyTouched(true); setReportFrequency(frequency); }}>{frequencyLabel(frequency, ar)}</button>)}
                </div>
              </div>
              <div className="vat-report-period-selects">
                <label className="vat-report-period-select"><span>{ar ? 'السنة' : 'Year'}</span><select aria-label={ar ? 'اختر سنة التقرير' : 'Choose report year'} value={reportYear} onChange={(event) => { const year = Number(event.target.value); setReportYear(year); setPeriodMonth(`${year}-${periodMonth.slice(5, 7)}`); }}>
                  {Array.from({ length: 11 }, (_, index) => new Date().getFullYear() - index).map((year) => <option key={year} value={year}>{year}</option>)}
                </select></label>
                <label className="vat-report-period-select"><span>{reportFrequency === 'MONTHLY' ? (ar ? 'الشهر' : 'Month') : (ar ? 'الربع' : 'Quarter')}<span className="vat-sr-only"> {ar ? 'ضمن السنة المحددة' : 'in selected year'}</span></span><select aria-label={reportFrequency === 'MONTHLY' ? (ar ? 'اختر شهر التقرير' : 'Choose report month') : (ar ? 'اختر ربع التقرير' : 'Choose report quarter')} value={reportFrequency === 'MONTHLY' ? periodMonth.slice(5, 7) : String(Math.floor((Number(periodMonth.slice(5, 7)) - 1) / 3) + 1)} onChange={(event) => { const selectedMonth = reportFrequency === 'MONTHLY' ? Number(event.target.value) : (Number(event.target.value) - 1) * 3 + 1; setPeriodMonth(`${reportYear}-${String(selectedMonth).padStart(2, '0')}`); }}>
                  {reportFrequency === 'MONTHLY'
                    ? Array.from({ length: 12 }, (_, index) => index + 1).map((month) => <option key={month} value={String(month).padStart(2, '0')}>{monthLabel(month, ar)}</option>)
                    : [1, 2, 3, 4].map((quarter) => <option key={quarter} value={quarter}>{ar ? `الربع ${['الأول', 'الثاني', 'الثالث', 'الرابع'][quarter - 1]}` : `Q${quarter}`}</option>)}
                </select></label>
              </div>
            </div>
            <div className="vat-report-filter vat-report-scope-filter">
              <span className="vat-filter-label">{ar ? 'نطاق التقرير' : 'Report scope'}</span>
              <div className="vat-report-scope-toggle" role="group" aria-label={ar ? 'نطاق التقرير' : 'Report scope'}>
                <button type="button" className={`vat-report-scope-option ${reportScope === 'COMPANY' ? 'active' : ''}`} aria-pressed={reportScope === 'COMPANY'} onClick={() => setReportScope('COMPANY')}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 20h16M6.5 20V5.5A1.5 1.5 0 0 1 8 4h8a1.5 1.5 0 0 1 1.5 1.5V20M9 8h.01M12 8h.01M15 8h.01M9 11.5h.01M12 11.5h.01M15 11.5h.01M10 20v-4h4v4"/></svg>
                  <span><strong>{ar ? 'الشركة' : 'Company'}</strong><small>{ar ? 'الجهة المحددة' : 'Selected entity'}</small></span>
                </button>
                <button type="button" className={`vat-report-scope-option ${reportScope === 'GROUP' ? 'active' : ''}`} aria-pressed={reportScope === 'GROUP'} disabled={!hasBranches} onClick={() => setReportScope('GROUP')}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="8" y="3.5" width="8" height="5.5" rx="1.5"/><rect x="3" y="15" width="7" height="5.5" rx="1.5"/><rect x="14" y="15" width="7" height="5.5" rx="1.5"/><path d="M12 9v3.5M6.5 15v-2.5h11V15"/></svg>
                  <span><strong>{ar ? 'الشركة وفروعها' : 'Company and branches'}</strong><small>{hasBranches ? (ar ? `${reportOrganizationIds.length} جهات ضمن التقرير` : `${reportOrganizationIds.length} entities in report`) : (ar ? 'لا توجد فروع مرتبطة' : 'No branches linked')}</small></span>
                </button>
              </div>
              <small className="vat-report-scope-footnote">{ar ? 'يؤثر النطاق على لوحة الإدارة فقط.' : 'Scope affects the dashboard only.'}</small>
            </div>
          </section>
          {activeTab === 'einvoicing' && <div className={`vat-settings-grid ${profileOpen || !profile ? 'is-editing' : ''}`}>
            <section id="vat-registration-profile" className={`vat-panel vat-registration vat-config-panel ${profile && !profileOpen ? 'has-summary' : ''}`}>
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
                <label><span>{ar ? 'رقم التسجيل الضريبي' : 'VAT registration number'}</span><input value={profileDraft.tax_registration_number} maxLength={15} inputMode="numeric" pattern="3[0-9]{13}3" onChange={(event) => setProfileDraft({ ...profileDraft, tax_registration_number: event.target.value })} required={profileDraft.registration_status === 'REGISTERED'} placeholder={ar ? '15 رقمًا، يبدأ وينتهي بالرقم 3' : '15 digits, starting and ending with 3'} /><small className="vat-field-hint">{ar ? 'يمكنك تصحيح الرقم من هنا؛ ثم يتحدث تلقائيًا في إعداد وحدة الفوترة قبل إرسالها إلى زاتكا.' : 'Correct the number here; it will update in the invoice unit setup before submission to ZATCA.'}</small></label>
                <label><span>{ar ? 'تاريخ التسجيل' : 'Registration date'}</span><input type="date" value={profileDraft.registration_date} onChange={(event) => setProfileDraft({ ...profileDraft, registration_date: event.target.value })} /></label>
                <label><span>{ar ? 'دورية الإقرار' : 'Filing frequency'}</span><select value={profileDraft.filing_frequency} onChange={(event) => setProfileDraft({ ...profileDraft, filing_frequency: event.target.value as VatFilingFrequency })}><option value="MONTHLY">{ar ? 'شهري' : 'Monthly'}</option><option value="QUARTERLY">{ar ? 'ربع سنوي' : 'Quarterly'}</option></select></label>
                <label><span>{ar ? 'النسبة الأساسية' : 'Standard VAT rate'}</span><input type="text" value="15%" readOnly aria-readonly="true" /><small className="vat-field-hint">{ar ? 'النسبة الأساسية المعتمدة حاليًا في السعودية' : 'Current Saudi standard rate'}</small></label>
                <label><span>{ar ? 'شهر بداية السنة الضريبية' : 'Tax year start month'}</span><select value={profileDraft.period_start_month} onChange={(event) => setProfileDraft({ ...profileDraft, period_start_month: event.target.value })}>{Array.from({ length: 12 }, (_, index) => <option key={index + 1} value={index + 1}>{monthLabel(index + 1, ar)}</option>)}</select></label>
                <fieldset className="vat-einvoice-group vat-profile-seller-fields">
                  <legend>{ar ? 'بيانات البائع والعنوان الوطني' : 'Seller and national address details'}</legend>
                  <div className="vat-einvoice-group-grid">
                    <label><span>{ar ? 'الاسم النظامي المسجل' : 'Registered legal name'}</span><input required={profileDraft.registration_status === 'REGISTERED'} maxLength={200} value={profileDraft.registered_name} onChange={(event) => setProfileDraft({ ...profileDraft, registered_name: event.target.value })} /></label>
                    <label><span>{ar ? 'الشارع' : 'Street'}</span><input required={profileDraft.registration_status === 'REGISTERED'} maxLength={250} value={profileDraft.seller_street} onChange={(event) => setProfileDraft({ ...profileDraft, seller_street: event.target.value })} /></label>
                    <label><span>{ar ? 'رقم المبنى (4 أرقام)' : 'Building number (4 digits)'}</span><input required={profileDraft.registration_status === 'REGISTERED'} inputMode="numeric" pattern="[0-9]{4}" maxLength={4} value={profileDraft.seller_building_number} onChange={(event) => setProfileDraft({ ...profileDraft, seller_building_number: event.target.value })} /></label>
                    <label><span>{ar ? 'الحي' : 'District'}</span><input required={profileDraft.registration_status === 'REGISTERED'} maxLength={120} value={profileDraft.seller_district} onChange={(event) => setProfileDraft({ ...profileDraft, seller_district: event.target.value })} /></label>
                    <label><span>{ar ? 'الرقم الإضافي (4 أرقام)' : 'Additional number (4 digits)'}</span><input required={profileDraft.registration_status === 'REGISTERED'} inputMode="numeric" pattern="[0-9]{4}" maxLength={4} value={profileDraft.seller_additional_number} onChange={(event) => setProfileDraft({ ...profileDraft, seller_additional_number: event.target.value })} /></label>
                    <label><span>{ar ? 'المدينة' : 'City'}</span><input required={profileDraft.registration_status === 'REGISTERED'} maxLength={120} value={profileDraft.seller_city} onChange={(event) => setProfileDraft({ ...profileDraft, seller_city: event.target.value })} /></label>
                    <label><span>{ar ? 'الرمز البريدي (5 أرقام)' : 'Postal code (5 digits)'}</span><input required={profileDraft.registration_status === 'REGISTERED'} inputMode="numeric" pattern="[0-9]{5}" maxLength={5} value={profileDraft.seller_postal_code} onChange={(event) => setProfileDraft({ ...profileDraft, seller_postal_code: event.target.value })} /></label>
                  </div>
                  <small className="vat-field-hint">{ar ? 'تظهر هذه البيانات تلقائيًا في الفواتير الإلكترونية الصادرة عن هذه المؤسسة.' : 'These details populate e-invoices issued by this organization.'}</small>
                </fieldset>
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
          </div>}



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
              monthlyTrend={monthlyTrend}
              monthlyTrendLoading={monthlyTrendLoading}
              upcomingObligations={upcomingObligations}
              organizationId={organizationId}
              onSaved={() => setInvoiceRefresh((revision) => revision + 1)}
            />}
          </div>

          <nav className="vat-tabs" role="tablist" aria-label={ar ? 'أقسام ضريبة القيمة المضافة' : 'VAT sections'} onKeyDown={handleTabKeyDown}>
            <button id="vat-tab-dashboard" type="button" role="tab" aria-selected={activeTab === 'dashboard'} tabIndex={activeTab === 'dashboard' ? 0 : -1} aria-controls="vat-panel-dashboard" className={activeTab === 'dashboard' ? 'active' : ''} onClick={() => selectTab('dashboard')}>
              <strong><span className="vat-tab-icon dashboard" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5h16"/><path d="M6.5 16V11M12 16V5M17.5 16V8"/></svg></span>{ar ? 'لوحة الإدارة' : 'Management dashboard'}</strong><small>{ar ? 'المبيعات والضريبة والاستحقاق والسيولة' : 'Sales, VAT, deadlines and cash'}</small>
            </button>
            <button id="vat-tab-aggregate" type="button" role="tab" aria-selected={activeTab === 'aggregate'} tabIndex={activeTab === 'aggregate' ? 0 : -1} aria-controls="vat-panel-aggregate" className={activeTab === 'aggregate' ? 'active' : ''} onClick={() => selectTab('aggregate')}>
              <strong><span className="vat-tab-icon aggregate" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="3.5" width="14" height="17" rx="2"/><path d="M8 7.5h8M8.5 11h.01M12 11h.01M15.5 11h.01M8.5 15h.01M12 15h.01M15.5 15h.01"/></svg></span>{ar ? 'إجماليات الفترة' : 'Period totals'}</strong><small>{ar ? 'إدخال مجمع للمبيعات والمشتريات' : 'Enter aggregated sales and purchases'}</small>
            </button>
            <button
              id="vat-tab-register"
              type="button"
              role="tab"
              aria-selected={activeTab === 'register'}
              tabIndex={activeTab === 'register' ? 0 : -1}
              aria-controls="vat-panel-register"
              className={activeTab === 'register' ? 'active' : ''}
              onClick={() => selectTab('register')}
            >
              <strong><span className="vat-tab-icon invoices" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M7 3.5h7l4 4v13H7z"/><path d="M14 3.5v4h4M10 12h5M10 16h5"/></svg></span>{ar ? 'الفواتير' : 'Invoices'}</strong>
              <small>{ar ? 'مساحة موحدة للمبيعات والمشتريات' : 'One workspace for sales and purchases'}</small>
            </button>
            <button
              id="vat-tab-einvoicing"
              type="button"
              role="tab"
              aria-selected={activeTab === 'einvoicing'}
              tabIndex={activeTab === 'einvoicing' ? 0 : -1}
              aria-controls="vat-panel-einvoicing"
              className={activeTab === 'einvoicing' ? 'active' : ''}
              onClick={() => selectTab('einvoicing')}
            >
              <strong><span className="vat-tab-icon zatca" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3.5 19 6v5.2c0 4.2-2.8 7.5-7 9.3-4.2-1.8-7-5.1-7-9.3V6z"/><path d="m9 12 2 2 4-4"/></svg></span>{ar ? 'إعداد وربط زاتكا' : 'ZATCA setup'}</strong>
              <small>{ar ? 'تهيئة الوحدة والشهادة' : 'Invoice unit and certificate setup'}</small>
            </button>
          </nav>

          <div id="vat-panel-aggregate" role="tabpanel" aria-labelledby="vat-tab-aggregate" hidden={activeTab !== 'aggregate'}>
            {isOfficialFilingPeriod ? <VatPeriodSummaryForm
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
            /> : <section className="vat-panel vat-report-analytical-note"><strong>{ar ? 'هذه فترة تحليلية' : 'Analytical reporting period'}</strong><p>{ar ? 'يمكنك استعراض الفواتير وإجمالياتها لهذه الفترة. إدخال ملخص الإقرار وحالة السداد متاحان فقط عند اختيار فترة الإقرار الرسمية للمنشأة.' : 'You can review invoices and totals for this period. Filing summaries and payment status are available only for the organization’s official filing period.'}</p></section>}
          </div>

          <div id="vat-panel-register" role="tabpanel" aria-labelledby="vat-tab-register" hidden={activeTab !== 'register'}>
          <div className="vat-invoice-kpis" aria-label={ar ? 'ملخص سجل الفواتير' : 'Invoice register summary'}>
            <div className="vat-invoice-kpi count"><span>{ar ? 'مستندات الفترة' : 'Period documents'}</span><strong>{registerDocuments.length}</strong><small>{ar ? `${registerDirection === 'SALES' ? 'مبيعات' : 'مشتريات'} · ${period.from} — ${period.to}` : `${registerDirection === 'SALES' ? 'Sales' : 'Purchases'} · ${period.from} — ${period.to}`}</small></div>
            <div className="vat-invoice-kpi net"><span>{registerDirection === 'SALES' ? (ar ? 'المبيعات قبل الضريبة' : 'Sales before VAT') : (ar ? 'المشتريات قبل الضريبة' : 'Purchases before VAT')}</span><strong>{money(registerSummary.net.toFixed(2))} <small>{baseCurrency}</small></strong><i aria-hidden="true">↗</i></div>
            <div className="vat-invoice-kpi tax"><span>{registerDirection === 'SALES' ? (ar ? 'ضريبة المخرجات' : 'Output VAT') : (ar ? 'ضريبة المدخلات' : 'Input VAT')}</span><strong>{money(registerSummary.tax.toFixed(2))} <small>{baseCurrency}</small></strong><i aria-hidden="true">%</i></div>
            <div className="vat-invoice-kpi gross"><span>{ar ? 'الإجمالي شامل الضريبة' : 'Total including VAT'}</span><strong>{money(registerSummary.gross.toFixed(2))} <small>{baseCurrency}</small></strong><i aria-hidden="true">▤</i></div>
          </div>
          <div className="vat-invoice-direction vat-register-direction" role="group" aria-label={ar ? 'نوع الفاتورة' : 'Invoice direction'}>
            <button type="button" aria-pressed={registerDirection === 'SALES'} className={registerDirection === 'SALES' ? 'active sales' : ''} onClick={() => { setRegisterDirection('SALES'); setRegisterFormOpen(false); setRegisterAddMenuOpen(false); setDraft((current) => ({ ...current, document_type: 'SALES', counterparty_contact_id: '', counterparty_name: '', counterparty_tax_number: '' })); }}>
              <strong>{ar ? 'المبيعات' : 'Sales'}</strong><small>{ar ? 'فواتير العملاء' : 'Customer invoices'}</small>
            </button>
            <button type="button" aria-pressed={registerDirection === 'PURCHASE'} className={registerDirection === 'PURCHASE' ? 'active purchase' : ''} onClick={() => { setRegisterDirection('PURCHASE'); setRegisterFormOpen(false); setRegisterAddMenuOpen(false); setDraft((current) => ({ ...current, document_type: 'PURCHASE', counterparty_contact_id: '', counterparty_name: '', counterparty_tax_number: '' })); }}>
              <strong>{ar ? 'المشتريات' : 'Purchases'}</strong><small>{ar ? 'فواتير الموردين' : 'Supplier invoices'}</small>
            </button>
          </div>
          {registerDirection === 'SALES' && <div className="vat-invoice-source-switch" role="group" aria-label={ar ? 'مصدر فاتورة المبيعات' : 'Sales invoice source'}>
            <button type="button" aria-pressed={salesEntryMode === 'ACCOUNTING'} className={salesEntryMode === 'ACCOUNTING' ? 'active' : ''} onClick={() => { setSalesEntryMode('ACCOUNTING'); setRegisterFormOpen(false); setRegisterAddMenuOpen(false); }}>{ar ? 'تسجيل فاتورة من نظام محاسبي' : 'Record an invoice from accounting software'}</button>
            <button type="button" aria-pressed={salesEntryMode === 'ZAKATFLOW'} className={salesEntryMode === 'ZAKATFLOW' ? 'active' : ''} onClick={() => { setSalesEntryMode('ZAKATFLOW'); setRegisterFormOpen(false); setRegisterAddMenuOpen(false); }}>{ar ? 'إنشاء فاتورة في زكاة فلو' : 'Create an invoice in ZakatFlow'}</button>
          </div>}
          {registerDirection === 'SALES' && salesEntryMode === 'ZAKATFLOW' && organizationId && <VatEInvoiceRegister
            key={`invoices-${organizationId}`}
            organizationId={organizationId}
            sellerProfile={{
              registered_name: profile?.registered_name ?? '',
              seller_street: profile?.seller_street ?? '',
              seller_building_number: profile?.seller_building_number ?? '',
              seller_district: profile?.seller_district ?? '',
              seller_additional_number: profile?.seller_additional_number ?? '',
              seller_city: profile?.seller_city ?? '',
              seller_postal_code: profile?.seller_postal_code ?? '',
            }}
            vatNumber={profile?.tax_registration_number ?? ''}
            standardTaxRate={Number(profile?.standard_rate ?? 15)}
            registered={isRegistered}
            ar={ar}
            onInvoiceIssued={() => setInvoiceRefresh((revision) => revision + 1)}
          />}
          {(registerDirection === 'PURCHASE' || salesEntryMode === 'ACCOUNTING') && <>
          <section className="vat-panel">
            <div className="vat-panel-head vat-register-entry-head">
              <div><span className="vat-eyebrow">{registerDirection === 'PURCHASE' ? (ar ? 'فاتورة مورد مستلمة' : 'RECEIVED SUPPLIER INVOICE') : (ar ? 'تسجيل من نظام محاسبي' : 'ACCOUNTING SYSTEM ENTRY')}</span><h2>{registerDirection === 'PURCHASE' ? (ar ? 'فواتير المشتريات' : 'Purchase invoices') : (ar ? 'فواتير المبيعات' : 'Sales invoices')}</h2><p>{registerDirection === 'PURCHASE' ? (ar ? 'يسجل هذا المسار ملخص الضريبة من فاتورة المورد.' : 'This path records the supplier invoice tax summary.') : (ar ? 'سجّل بيانات الفاتورة وبنودها وتصنيف كل بند؛ تُحتسب الضريبة دون إصدار فاتورة إلكترونية.' : 'Record invoice details and line items with their tax treatment; VAT is calculated without issuing an e-invoice.')}</p></div>
              <div className="vat-add-menu-wrap">
                <button type="button" className="vat-button primary vat-add-document" aria-expanded={registerAddMenuOpen} onClick={() => setRegisterAddMenuOpen((open) => !open)} disabled={!isRegistered || saving}><span aria-hidden="true">＋</span>{ar ? 'إضافة' : 'Add'}</button>
                {registerAddMenuOpen && <div className="vat-add-menu" role="group" aria-label={ar ? 'نوع المستند الجديد' : 'New document type'}>
                  <button type="button" onClick={() => startRegisterEntry('INVOICE')}><strong>{ar ? 'فاتورة' : 'Invoice'}</strong><small>{ar ? 'تسجيل فاتورة من النظام المحاسبي' : 'Record an accounting-system invoice'}</small></button>
                  <button type="button" onClick={() => startRegisterEntry('CREDIT_NOTE')}><strong>{ar ? 'إشعار دائن' : 'Credit note'}</strong><small>{ar ? 'تسجيل إشعار دائن على فاتورة سابقة' : 'Record a credit note against an earlier invoice'}</small></button>
                </div>}
              </div>
            </div>
            {registerFormOpen && <form className="vat-form-grid vat-document-form" onSubmit={addDocument}>
              <div className="vat-document-contact-field">
                <VatContactPicker
                  key={`${organizationId}-${draft.document_type}`}
                  organizationId={organizationId}
                  role={draft.document_type === 'SALES' ? 'CUSTOMER' : 'SUPPLIER'}
                  ar={ar}
                  label={draft.document_type === 'SALES' ? (ar ? 'العميل / المشتري' : 'Customer / buyer') : (ar ? 'المورد' : 'Supplier')}
                  value={draft.counterparty_contact_id}
                  required
                  onChange={(contact: VatContact | null) => setDraft({
                    ...draft,
                    counterparty_contact_id: contact?.id ?? '',
                    counterparty_name: contact?.name ?? '',
                    counterparty_tax_number: contact?.vat_number ?? '',
                  })}
                />
              </div>
              <div className="vat-document-meta">
                <label><span>{ar ? 'نوع المستند' : 'Document type'}</span><select value={draft.document_kind} onChange={(event) => setDraft({ ...draft, document_kind: event.target.value as DocumentDraft['document_kind'], notes: event.target.value === 'INVOICE' ? '' : draft.notes })}><option value="INVOICE">{ar ? 'فاتورة' : 'Invoice'}</option><option value="CREDIT_NOTE">{ar ? 'إشعار دائن' : 'Credit note'}</option></select></label>
                <label><span>{ar ? 'رقم المستند' : 'Document number'}</span><input required maxLength={80} value={draft.document_number} onChange={(event) => setDraft({ ...draft, document_number: event.target.value })} /></label>
                <label><span>{ar ? 'التاريخ الضريبي' : 'Tax date'}</span><input required type="date" value={draft.transaction_date} onChange={(event) => setDraft({ ...draft, transaction_date: event.target.value })} /></label>
              </div>
              {usesAccountingLines ? <div className="vat-accounting-lines">
                <div className="vat-accounting-toolbar">
                  <label className="vat-currency-select"><span>{ar ? 'عملة الفاتورة' : 'Invoice currency'}</span><select value={invoiceCurrency} onChange={(event) => setInvoiceCurrency(event.target.value)}>{Array.from(new Set([baseCurrency, ...currencies.map((currency) => currency.code)])).map((code) => <option key={code} value={code}>{currencyName(code)}</option>)}</select></label>
                  {isForeignCurrency && <label className="vat-toolbar-rate"><span>{ar ? `سعر التحويل إلى ${baseCurrency}` : `Rate to ${baseCurrency}`}</span><input inputMode="decimal" type="number" min="0.00000001" step="any" value={exchangeRate} onChange={(event) => setExchangeRate(event.target.value)} placeholder={ar ? 'سعر الصرف' : 'Exchange rate'} /></label>}
                  <label className="vat-price-tax-mode"><span>{ar ? 'طريقة احتساب السعر' : 'Price tax mode'}</span><select value={accountingPricesIncludeVat ? 'INCLUSIVE' : 'EXCLUSIVE'} onChange={(event) => setAccountingPricesIncludeVat(event.target.value === 'INCLUSIVE')}><option value="EXCLUSIVE">{ar ? 'الأسعار غير شاملة الضريبة' : 'Prices exclude VAT'}</option><option value="INCLUSIVE">{ar ? 'الأسعار شاملة الضريبة' : 'Prices include VAT'}</option></select></label>
                  <button type="button" className="vat-button secondary vat-edit-fields" aria-expanded={showAccountingFields} onClick={() => setShowAccountingFields((value) => !value)}>{ar ? 'تعديل الحقول' : 'Edit fields'} <span aria-hidden="true">{showAccountingFields ? '⌃' : '⌄'}</span></button>
                </div>
                {showAccountingFields && <div className="vat-accounting-field-settings">
                  <header><strong>{ar ? 'تخصيص الحقول' : 'Customize fields'}</strong><button type="button" aria-label={ar ? 'إغلاق تخصيص الحقول' : 'Close field settings'} onClick={() => setShowAccountingFields(false)}>×</button></header>
                  <div className="vat-setting-choice"><span>{ar ? 'طريقة عرض السعر' : 'Price display'}</span><div className="vat-segmented-choice" role="group" aria-label={ar ? 'طريقة عرض السعر' : 'Price display'}><button type="button" aria-pressed={accountingPriceDisplay === 'UNIT'} className={accountingPriceDisplay === 'UNIT' ? 'active' : ''} onClick={() => setAccountingPriceDisplay('UNIT')}>{ar ? 'سعر الوحدة' : 'Unit price'}</button><button type="button" aria-pressed={accountingPriceDisplay === 'LINE'} className={accountingPriceDisplay === 'LINE' ? 'active' : ''} onClick={() => setAccountingPriceDisplay('LINE')}>{ar ? 'إجمالي البند' : 'Line total'}</button></div></div>
                  <div className="vat-setting-choice"><span>{ar ? 'الخصم' : 'Discount'}</span><div className="vat-segmented-choice" role="group" aria-label={ar ? 'نوع الخصم' : 'Discount type'}><button type="button" aria-pressed={accountingDiscountMode === 'NONE'} className={accountingDiscountMode === 'NONE' ? 'active' : ''} onClick={() => setAccountingDiscountMode('NONE')}>{ar ? 'بدون' : 'None'}</button><button type="button" aria-pressed={accountingDiscountMode === 'AMOUNT'} className={accountingDiscountMode === 'AMOUNT' ? 'active' : ''} onClick={() => setAccountingDiscountMode('AMOUNT')}>{ar ? 'قيمة' : 'Amount'}</button><button type="button" aria-pressed={accountingDiscountMode === 'PERCENT'} className={accountingDiscountMode === 'PERCENT' ? 'active' : ''} onClick={() => setAccountingDiscountMode('PERCENT')}>{ar ? 'نسبة %' : 'Percent %'}</button></div></div>
                  <label className="vat-unit-toggle"><input type="checkbox" checked={showAccountingUnits} onChange={(event) => setShowAccountingUnits(event.target.checked)} /><span>{ar ? 'إظهار وحدة القياس' : 'Show unit of measure'}</span></label>
                </div>}
                <div className="vat-accounting-lines-head"><div><strong>{ar ? 'بنود الفاتورة' : 'Invoice lines'}</strong><small>{ar ? `اختر الخدمة من وصف كل بند، أو أضف خدمة من قائمته؛ الأسعار ${accountingPricesIncludeVat ? 'شاملة' : 'غير شاملة'} الضريبة.` : `Choose a service in each description field or add one from its list; prices ${accountingPricesIncludeVat ? 'include' : 'exclude'} VAT.`}</small></div><div className="vat-line-catalog-actions"><button type="button" className="vat-button secondary" onClick={() => setAccountingLines((lines) => [...lines, emptyDocumentLine()])}>{ar ? '＋ إضافة بند' : '＋ Add line'}</button></div></div>
                <div className={`vat-accounting-lines-table ${showAccountingUnits ? 'with-units' : ''} ${accountingDiscountMode === 'NONE' ? 'without-discount' : ''}`}><div className="vat-accounting-line vat-accounting-line-labels"><span>{ar ? '#' : '#'}</span><span>{ar ? 'وصف البند' : 'Description'}</span>{showAccountingUnits && <span>{ar ? 'الوحدة' : 'Unit'}</span>}<span>{ar ? 'الكمية' : 'Qty'}</span><span>{accountingPriceDisplay === 'UNIT' ? (ar ? 'السعر' : 'Price') : (ar ? 'إجمالي البند' : 'Line total')}</span>{accountingDiscountMode !== 'NONE' && <span>{accountingDiscountMode === 'PERCENT' ? (ar ? 'الخصم %' : 'Discount %') : (ar ? 'الخصم (قيمة)' : 'Discount amount')}</span>}<span>{ar ? 'الضريبة' : 'VAT'}</span><span>{ar ? 'الإجمالي' : 'Total'}</span><span aria-hidden="true"></span></div>
                  {accountingLines.map((line, index) => <div className="vat-accounting-line-wrap" key={index}><div className="vat-accounting-line">
                    <span className="vat-line-index">{index + 1}</span>
                    <select aria-label={ar ? `وصف البند ${index + 1}` : `Description for line ${index + 1}`} required value={line.description} onChange={(event) => {
                      const selected = event.target.value;
                      if (selected === '__add__') { setServiceAddForIndex(index); setServiceNameDraft(''); return; }
                      setAccountingLines((lines) => lines.map((item, itemIndex) => itemIndex === index ? { ...item, description: selected } : item));
                    }}><option value="">{ar ? 'اختر خدمة…' : 'Choose service…'}</option>{line.description && !serviceCatalog.includes(line.description) && <option value={line.description}>{line.description}</option>}{serviceCatalog.map((item) => <option key={item} value={item}>{item}</option>)}<option value="__add__">{ar ? '＋ إضافة خدمة جديدة…' : '＋ Add new service…'}</option></select>
                    {showAccountingUnits && <input aria-label={ar ? 'وحدة القياس' : 'Unit of measure'} maxLength={24} placeholder={ar ? 'وحدة' : 'Unit'} value={line.unit} onChange={(event) => setAccountingLines((lines) => lines.map((item, itemIndex) => itemIndex === index ? { ...item, unit: event.target.value } : item))} />}
                    <input aria-label={ar ? 'الكمية' : 'Quantity'} required type="number" min="0.001" step="0.001" value={line.quantity} onChange={(event) => setAccountingLines((lines) => lines.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: event.target.value } : item))} />
                    <input aria-label={accountingPriceDisplay === 'UNIT' ? (ar ? 'سعر الوحدة' : 'Unit price') : (ar ? 'إجمالي البند' : 'Line total')} required type="number" min="0" step="0.01" value={line.unit_price} onChange={(event) => setAccountingLines((lines) => lines.map((item, itemIndex) => itemIndex === index ? { ...item, unit_price: event.target.value } : item))} />
                    {accountingDiscountMode !== 'NONE' && <input aria-label={accountingDiscountMode === 'PERCENT' ? (ar ? 'نسبة الخصم' : 'Discount percentage') : (ar ? 'قيمة الخصم' : 'Discount amount')} type="number" min="0" max={accountingDiscountMode === 'PERCENT' ? 100 : undefined} step="0.01" value={line.discount_amount} onChange={(event) => setAccountingLines((lines) => lines.map((item, itemIndex) => itemIndex === index ? { ...item, discount_amount: event.target.value } : item))} />}
                    <select aria-label={ar ? 'المعاملة الضريبية' : 'Tax treatment'} value={line.supply_type} onChange={(event) => setAccountingLines((lines) => lines.map((item, itemIndex) => itemIndex === index ? { ...item, supply_type: event.target.value as DocumentLineDraft['supply_type'] } : item))}><option value="STANDARD">{ar ? `أساسي ${currentTaxRate}%` : `Standard ${currentTaxRate}%`}</option><option value="ZERO_RATED">{ar ? 'صفري' : 'Zero-rated'}</option><option value="EXEMPT">{ar ? 'معفى' : 'Exempt'}</option><option value="OUT_OF_SCOPE">{ar ? 'خارج النطاق' : 'Out of scope'}</option></select>
                    <div className="vat-accounting-line-total"><strong>{displayInvoiceAmount(accountingLineTotals.lines[index]?.gross_amount ?? 0, invoiceCurrency)}</strong><small>{ar ? 'صافي' : 'Net'} {money(accountingLineTotals.lines[index]?.net_amount ?? 0)} · {ar ? 'ضريبة' : 'VAT'} {money(accountingLineTotals.lines[index]?.tax_amount ?? 0)}</small></div><button type="button" className="vat-delete" aria-label={ar ? 'حذف البند' : 'Remove line'} disabled={accountingLines.length === 1} onClick={() => { setAccountingLines((lines) => lines.filter((_, itemIndex) => itemIndex !== index)); setServiceAddForIndex((current) => current === index ? null : current !== null && current > index ? current - 1 : current); }}>×</button>
                  </div>{serviceAddForIndex === index && <div className="vat-service-add-inline"><label><span>{ar ? 'اسم الخدمة الجديدة' : 'New service name'}</span><input autoFocus maxLength={200} value={serviceNameDraft} onChange={(event) => setServiceNameDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addServiceToCatalog(); } }} /></label><button type="button" className="vat-button primary" disabled={!serviceNameDraft.trim()} onClick={addServiceToCatalog}>{ar ? 'إضافة واختيار' : 'Add and select'}</button><button type="button" className="vat-button secondary" onClick={() => { setServiceAddForIndex(null); setServiceNameDraft(''); }}>{ar ? 'إلغاء' : 'Cancel'}</button></div>}</div>)}
                </div>
              </div> : <>
                <label><span>{ar ? 'تصنيف التوريد' : 'Supply category'}</span><select value={draft.supply_type} onChange={(event) => setDraft({ ...draft, supply_type: event.target.value as DocumentDraft['supply_type'] })}><option value="STANDARD">{ar ? `خاضع للنسبة الأساسية (${currentTaxRate}%)` : `Standard rated (${currentTaxRate}%)`}</option><option value="ZERO_RATED">{ar ? 'خاضع للنسبة الصفرية' : 'Zero-rated'}</option><option value="EXEMPT">{ar ? 'معفى' : 'Exempt'}</option><option value="OUT_OF_SCOPE">{ar ? 'خارج النطاق' : 'Out of scope'}</option></select></label>
                <label><span>{ar ? `صافي المبلغ (${baseCurrency})` : `Net amount (${baseCurrency})`}</span><input required type="number" min="0.01" step="0.01" value={draft.net_amount} onChange={(event) => setDraft({ ...draft, net_amount: event.target.value })} /></label>
              </>}
              {draft.document_type === 'PURCHASE' && <label><span>{ar ? 'نسبة ضريبة المدخلات القابلة للخصم (%)' : 'Recoverable input VAT (%)'}</span><input required type="number" min="0" max="100" step="0.01" value={draft.recoverable_percent} onChange={(event) => setDraft({ ...draft, recoverable_percent: event.target.value })} /></label>}
              <label className="vat-notes-field"><span>{draft.document_kind === 'CREDIT_NOTE' ? (ar ? 'مرجع الفاتورة وسبب الإشعار' : 'Original invoice reference and reason') : (ar ? 'ملاحظات' : 'Notes')}</span><input required={draft.document_kind === 'CREDIT_NOTE'} maxLength={1000} placeholder={draft.document_kind === 'CREDIT_NOTE' ? (ar ? 'رقم الفاتورة الأصلية وسبب الإشعار' : 'Original invoice number and reason') : undefined} value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} /></label>
              {usesAccountingLines ? <section className="vat-accounting-totals" aria-label={ar ? 'ملخص الفاتورة' : 'Invoice summary'}>
                <header className="vat-accounting-summary-heading">
                  <span className="vat-accounting-summary-icon" aria-hidden="true">▤</span>
                  <div><h3>{ar ? 'ملخص الفاتورة' : 'Invoice summary'}</h3><p>{ar ? 'تفصيل المبالغ بالعملة المختارة وبالعملة الأساسية.' : 'Amounts in the selected currency and the base currency.'}</p></div>
                </header>
                <div className={`vat-accounting-currency-grid ${isForeignCurrency ? 'has-base-currency' : ''}`}>
                  <section className="vat-accounting-currency-card invoice-currency">
                    <header><span className="vat-accounting-currency-icon" aria-hidden="true">¤</span><div><small>{ar ? 'عملة الفاتورة' : 'Invoice currency'}</small><strong>{currencyName(invoiceCurrency)}</strong></div><b className="vat-currency-code">{invoiceCurrency}</b></header>
                    <div className="vat-accounting-summary-rows">
                      <div><span>{ar ? 'الإجمالي قبل الضريبة' : 'Subtotal before VAT'}</span><strong>{displayInvoiceAmount(accountingLineTotals.netAmount, invoiceCurrency)}</strong></div>
                      <div><span>{ar ? 'ضريبة القيمة المضافة' : 'Value added tax'}</span><strong>{displayInvoiceAmount(accountingLineTotals.taxAmount, invoiceCurrency)}</strong></div>
                      <div className="is-grand-total"><span>{ar ? 'الإجمالي شامل الضريبة' : 'Total including VAT'}</span><strong>{displayInvoiceAmount(accountingLineTotals.grossAmount, invoiceCurrency)}</strong></div>
                    </div>
                  </section>
                  {isForeignCurrency && <section className="vat-accounting-currency-card base-currency">
                    <header><span className="vat-accounting-currency-icon base" aria-hidden="true">﷼</span><div><small>{ar ? 'ما يعادلها بالعملة الأساسية' : 'Base currency equivalent'}</small><strong>{currencyName(baseCurrency)}</strong></div><b className="vat-currency-code">{baseCurrency}</b></header>
                    {accountingBaseTotals ? <div className="vat-accounting-summary-rows">
                      <div><span>{ar ? 'الإجمالي قبل الضريبة' : 'Subtotal before VAT'}</span><strong>{displayInvoiceAmount(accountingBaseTotals.netAmount, baseCurrency)}</strong></div>
                      <div><span>{ar ? 'ضريبة القيمة المضافة' : 'Value added tax'}</span><strong>{displayInvoiceAmount(accountingBaseTotals.taxAmount, baseCurrency)}</strong></div>
                      <div className="is-grand-total"><span>{ar ? 'الإجمالي شامل الضريبة' : 'Total including VAT'}</span><strong>{displayInvoiceAmount(accountingBaseTotals.grossAmount, baseCurrency)}</strong></div>
                    </div> : <p className="vat-accounting-rate-hint">{ar ? 'أدخل سعر التحويل لإظهار المبالغ بالعملة الأساسية.' : 'Enter an exchange rate to show amounts in the base currency.'}</p>}
                    <div className="vat-accounting-rate-note"><span aria-hidden="true">↔</span>{ar ? `سعر التحويل: 1 ${invoiceCurrency} = ${Number.isFinite(resolvedRate) && resolvedRate > 0 ? money(resolvedRate) : '—'} ${baseCurrency}` : `Exchange rate: 1 ${invoiceCurrency} = ${Number.isFinite(resolvedRate) && resolvedRate > 0 ? money(resolvedRate) : '—'} ${baseCurrency}`}</div>
                  </section>}
                </div>
              </section> : <div className="vat-tax-preview"><span>{ar ? 'صافي الفاتورة' : 'Invoice net'} <strong>{money(Number(draft.net_amount || 0))} {baseCurrency}</strong></span><span>{ar ? 'الضريبة المحسوبة' : 'Calculated VAT'} <strong>{money(previewTax)} {baseCurrency}</strong></span><span>{ar ? 'الإجمالي' : 'Gross total'} <strong>{money(Number(draft.net_amount || 0) + previewTax)} {baseCurrency}</strong></span></div>}
              <div className="vat-form-actions"><button type="button" className="vat-button secondary" onClick={() => { setRegisterFormOpen(false); setRegisterAddMenuOpen(false); }}>{ar ? 'إلغاء' : 'Cancel'}</button><button className="vat-button primary vat-submit" disabled={saving || !isRegistered || (usesAccountingLines && isForeignCurrency && (!Number.isFinite(resolvedRate) || resolvedRate <= 0))}>{saving ? (ar ? 'جارٍ الحفظ…' : 'Saving…') : (ar ? 'حفظ في السجل' : 'Save to register')}</button></div>
            </form>}
          </section>

          <section className="vat-panel">
            <div className="vat-panel-head vat-register-heading">
              <div><span className="vat-eyebrow">{ar ? 'سجل المستندات' : 'DOCUMENT REGISTER'}</span><h2>{registerDirection === 'PURCHASE' ? (ar ? 'فواتير المشتريات' : 'Purchase invoices') : (ar ? 'فواتير المبيعات' : 'Sales invoices')}</h2><p>{loadingData ? (ar ? 'جارٍ تحديث السجل…' : 'Refreshing register…') : `${filteredRegisterDocuments.length} ${ar ? 'من' : 'of'} ${registerDocuments.length} ${ar ? 'مستند' : 'documents'}`}</p></div>
              <span className="vat-period-chip"><span aria-hidden="true">◷</span>{period.from} — {period.to}</span>
            </div>
            <div className="vat-invoice-register-toolbar">
              <label className="vat-invoice-search"><span className="vat-invoice-search-icon" aria-hidden="true">⌕</span><input type="search" value={registerSearch} onChange={(event) => setRegisterSearch(event.target.value)} placeholder={ar ? 'ابحث باسم العميل أو رقم الفاتورة' : 'Search customer or invoice number'} aria-label={ar ? 'البحث في الفواتير' : 'Search invoices'} /></label>
              <label className="vat-invoice-filter"><span>{ar ? 'نوع المستند' : 'Document type'}</span><select value={registerKindFilter} onChange={(event) => setRegisterKindFilter(event.target.value as typeof registerKindFilter)}><option value="ALL">{ar ? 'كل الأنواع' : 'All types'}</option><option value="INVOICE">{ar ? 'فواتير' : 'Invoices'}</option><option value="CREDIT_NOTE">{ar ? 'إشعارات دائنة' : 'Credit notes'}</option></select></label>
              <label className="vat-invoice-filter"><span>{ar ? 'المصدر' : 'Source'}</span><select value={registerSourceFilter} onChange={(event) => setRegisterSourceFilter(event.target.value as typeof registerSourceFilter)}><option value="ALL">{ar ? 'كل المصادر' : 'All sources'}</option><option value="EINVOICE">{ar ? 'صادرة من زكاة فلو' : 'Issued by ZakatFlow'}</option><option value="ACCOUNTING">{ar ? 'مسجلة من نظام محاسبي' : 'Accounting entry'}</option></select></label>
            </div>
            <p className="vat-invoice-register-hint">{ar ? 'مسودات الفواتير الإلكترونية قابلة للتعديل قبل الإصدار النهائي. بيانات البائع محفوظة في ملف التسجيل وتظهر في الطباعة وملف PDF.' : 'E-invoice drafts can be edited before final issuance. Seller details are saved in the registration profile and appear in print and PDF.'}</p>
            <div className="vat-table-wrap"><table className="vat-table">
              <thead><tr><th>{registerDirection === 'PURCHASE' ? (ar ? 'المورد' : 'Supplier') : (ar ? 'العميل / المشتري' : 'Customer / buyer')}</th><th>{ar ? 'نوع المستند' : 'Document type'}</th><th>{ar ? 'رقم الفاتورة' : 'Invoice number'}</th><th>{ar ? 'تاريخ الفاتورة' : 'Invoice date'}</th><th>{ar ? 'التصنيف الضريبي' : 'Tax category'}</th><th>{ar ? 'قبل الضريبة' : 'Before VAT'}</th><th>{ar ? 'الضريبة' : 'VAT'}</th><th>{ar ? 'شامل الضريبة' : 'Including VAT'}</th><th>{ar ? 'المصدر' : 'Source'}</th><th>{ar ? 'إجراءات' : 'Actions'}</th></tr></thead>
              <tbody>
                {filteredRegisterDocuments.map((document) => <tr key={document.id}>
                  <td className="vat-invoice-counterparty"><strong>{document.counterparty_name || (ar ? 'بدون اسم جهة' : 'Unnamed counterparty')}</strong><small>{document.counterparty_tax_number || ''}</small></td><td><span className={`vat-type-pill ${document.document_kind === 'CREDIT_NOTE' ? 'credit' : 'invoice'}`}>{document.document_kind === 'CREDIT_NOTE' ? (ar ? 'إشعار دائن' : 'Credit note') : (ar ? 'فاتورة ضريبية' : 'Tax invoice')}</span></td>
                  <td><strong className="vat-invoice-number">{document.document_number}</strong></td><td dir="ltr">{document.transaction_date}</td><td>{document.line_items && new Set(document.line_items.map((line) => line.supply_type)).size > 1 ? (ar ? 'متعدد التصنيفات' : 'Mixed tax categories') : supplyLabel(document.supply_type, ar)}</td><td>{vatDocumentAmount(document, 'net')}</td><td>{vatDocumentAmount(document, 'tax')}</td><td className="vat-invoice-gross">{vatDocumentAmount(document, 'gross')}</td><td><span className={`vat-invoice-source ${document.is_einvoice ? 'electronic' : ''}`}>{document.is_einvoice ? (ar ? 'زكاة فلو · إلكترونية' : 'ZakatFlow · e-invoice') : (ar ? 'إدخال محاسبي' : 'Accounting entry')}</span></td><td>{document.is_einvoice ? <span className="vat-field-hint">{ar ? 'عرض' : 'View'}</span> : <button type="button" className="vat-delete" onClick={() => void deleteDocument(document.id)} disabled={saving} aria-label={ar ? `حذف ${document.document_number}` : `Delete ${document.document_number}`}>×</button>}</td>
                </tr>)}
                {!filteredRegisterDocuments.length && <tr><td colSpan={10} className="vat-empty-row">{loadingData ? (ar ? 'جارٍ التحميل…' : 'Loading…') : registerDocuments.length ? (ar ? 'لا توجد مستندات تطابق خيارات البحث.' : 'No documents match these filters.') : (registerDirection === 'PURCHASE' ? (ar ? 'لا توجد فواتير مشتريات مسجلة لهذه الفترة.' : 'No purchase invoices have been recorded for this period.') : (ar ? 'لا توجد فواتير مبيعات مسجلة لهذه الفترة.' : 'No sales invoices have been recorded for this period.'))}</td></tr>}
              </tbody>
            </table></div>
          </section>

          <p className="vat-disclaimer">{ar ? 'تتضمن الملخصات الفواتير الصادرة المسجلة هنا. لا ترسل هذه الشاشة الإقرار إلى هيئة الزكاة والضريبة والجمارك، وإصدار QR للمرحلة الأولى لا يغني عن تكامل المرحلة الثانية عند انطباقه. راجع التصنيف الضريبي ومواعيد الإقرار قبل التقديم.' : 'Summaries include invoices issued here. This screen does not submit returns to ZATCA, and Phase 1 QR issuance does not replace Phase 2 integration when applicable. Review tax treatment and filing dates before submission.'}</p>
          </>}
          </div>
          <div id="vat-panel-einvoicing" role="tabpanel" aria-labelledby="vat-tab-einvoicing" hidden={activeTab !== 'einvoicing'}>
            <section className="vat-panel vat-einvoice-overview">
              <div>
                <span className="vat-eyebrow">{ar ? 'متطلبات الفوترة الإلكترونية' : 'E-INVOICING REQUIREMENTS'}</span>
                <h2>{ar ? 'إعداد وحدة الفوترة وربط زاتكا' : 'Invoice unit and ZATCA connection'}</h2>
                <p>{ar ? 'تُجهّز الوحدة والشهادة والاختبار هنا. إنشاء مسودة فاتورة المبيعات وإصدارها من زكاة فلو متاحان ضمن تبويب «الفواتير»؛ أما فاتورة الشراء فهي مستند مستلم ولا تُصدرها المنشأة إلى زاتكا.' : 'Prepare the invoice unit, certificate and tests here. Sales invoice drafts and issuance are under “Invoices”. Purchase invoices are received documents and are not issued to ZATCA by your organization.'}</p>
              </div>
              <span className="vat-status pending">{ar ? 'استكمال المتطلبات قيد العمل' : 'Requirements review in progress'}</span>
              <div className="vat-einvoice-steps" aria-label={ar ? 'آلية العمل' : 'Workflow'}>
                <span><b>1</b>{ar ? 'إعداد بيانات الوحدة' : 'Set up the invoice unit'}</span>
                <span><b>2</b>{ar ? 'طلب شهادة المحاكاة' : 'Request a simulation certificate'}</span>
                <span><b>3</b>{ar ? 'الاختبار ثم تهيئة الإنتاج' : 'Test, then configure production'}</span>
              </div>
            </section>
            {organizationId && <VatEInvoiceSetup
              key={`${organizationId}-${profile?.tax_registration_number ?? ''}`}
              organizationId={organizationId}
              organizationName={selectedOrganization?.name ?? ''}
              vatNumber={profile?.tax_registration_number ?? ''}
              registered={isRegistered}
              ar={ar}
              onEditRegistration={() => {
                setProfileOpen(true);
                setProfileDetailsOpen(true);
                requestAnimationFrame(() => document.getElementById('vat-registration-profile')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
              }}
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

function combineReportData(rows: ApiData[], reportPeriod: { from: string; to: string }): ApiData {
  const source = rows[rows.length - 1];
  if (!source) throw new Error('VAT_PERIOD_DATA_MISSING');
  const matchingOfficialPeriod = rows.every((row) => row.period.from === reportPeriod.from && row.period.to === reportPeriod.to);
  const docsById = new Map<string, VatDocument>();
  for (const row of rows) for (const document of row.documents) {
    if (document.transaction_date < reportPeriod.from || document.transaction_date > reportPeriod.to) continue;
    const key = document.id || `${document.document_type}:${document.document_number}:${document.transaction_date}`;
    if (!docsById.has(key)) docsById.set(key, document);
  }
  const documents = Array.from(docsById.values());
  const periodSummary = matchingOfficialPeriod ? source.periodSummary : null;
  const periodTotals = matchingOfficialPeriod
    ? rows[0].periodTotals
    : rows.length > 1 && rows.every((row) => row.profile?.filing_frequency === 'MONTHLY')
      ? aggregateVatDashboardTotals(rows.map((row) => row.periodTotals))
      : (() => {
        const summary = summarizeVatDocuments(documents);
        const salesGross = new Decimal(summary.salesNet).add(summary.outputTax).toFixed(2);
        return {
          ...emptyTotals(),
          ...summary,
          salesBase: summary.salesNet,
          salesGross,
          purchaseBase: summary.purchaseNet,
          purchaseVatBeforeRecovery: summary.inputTax,
          paidAmount: '0',
          cashReservedAmount: '0',
          filingStatus: 'NOT_FILED',
          dueDate: '',
        };
      })();
  return {
    ...source,
    period: reportPeriod,
    periodSummary,
    periodTotals,
    documents,
  };
}

function money(value: string | number) {
  return Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function vatDocumentAmount(document: VatDocument, part: 'net' | 'tax' | 'gross') {
  const currency = document.currency || 'SAR';
  const sourceCurrency = document.source_currency || currency;
  const baseAmount = document[`${part}_amount` as 'net_amount' | 'tax_amount' | 'gross_amount'];
  const sourceAmount = document[`source_${part}_amount` as 'source_net_amount' | 'source_tax_amount' | 'source_gross_amount'];
  const sign = document.document_kind === 'CREDIT_NOTE' ? '−' : '';
  return <>{sign}{money(baseAmount)} {currency}{sourceCurrency !== currency && sourceAmount !== undefined && <small>{sign}{money(sourceAmount)} {sourceCurrency}</small>}</>;
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

function monthsInRange(from: string, to: string) {
  const start = new Date(`${from.slice(0, 7)}-01T00:00:00Z`);
  const end = new Date(`${to.slice(0, 7)}-01T00:00:00Z`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start > end) return [];
  const months: string[] = [];
  for (const cursor = new Date(start); cursor <= end; cursor.setUTCMonth(cursor.getUTCMonth() + 1)) {
    months.push(`${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return months;
}

function messageFor(code: string, ar: boolean) {
  const labels: Record<string, [string, string]> = {
    UNAUTHORIZED: ['يلزم تسجيل الدخول.', 'Please sign in.'],
    ORGANIZATION_ACCESS_REQUIRED: ['ليس لديك صلاحية الوصول إلى هذه المؤسسة.', 'You do not have access to this organization.'],
    ORGANIZATION_ADMIN_REQUIRED: ['إدارة الملف الضريبي متاحة لمالك المؤسسة أو مديرها.', 'Only organization owners and admins can manage VAT data.'],
    VAT_REGISTRATION_NUMBER_REQUIRED: ['أدخل رقم التسجيل الضريبي للمؤسسة المسجلة.', 'Enter the VAT number for a registered organization.'],
    INVALID_VAT_REGISTRATION_NUMBER: ['رقم التسجيل الضريبي يجب أن يتكون من 15 رقمًا ويبدأ وينتهي بالرقم 3.', 'The VAT registration number must contain 15 digits and start and end with 3.'],
    VAT_REGISTRATION_REQUIRED: ['يجب حفظ حالة التسجيل كـ «مسجل» قبل إضافة المستندات.', 'Mark the organization as registered before adding documents.'],
    VAT_PROFILE_REQUIRED: ['احفظ ملف التسجيل أولًا.', 'Save the VAT registration profile first.'],
    VAT_DOCUMENT_NUMBER_EXISTS: ['رقم المستند مستخدم من قبل ضمن هذا النوع.', 'This document number already exists for this document type.'],
    VAT_CURRENCY_NOT_ACTIVE: ['العملة المختارة غير مفعّلة. حدّث قائمة العملات ثم أعد المحاولة.', 'The selected currency is not active. Refresh the currency list and try again.'],
    VAT_SAME_CURRENCY_RATE_MUST_BE_ONE: ['عندما تتطابق عملة الفاتورة مع العملة الأساسية، يجب أن يكون سعر التحويل 1.', 'The exchange rate must be 1 when invoice and base currencies match.'],
    VAT_EXCHANGE_RATE_REQUIRED: ['أدخل سعر التحويل إلى عملة الشركة الأساسية قبل الحفظ.', 'Enter the conversion rate to the organization base currency before saving.'],
    VAT_LINE_DISCOUNT_EXCEEDS_AMOUNT: ['لا يمكن أن يتجاوز الخصم إجمالي قيمة البند.', 'The discount cannot exceed the line amount.'],
    VAT_LINE_DISCOUNT_PERCENT_EXCEEDS_100: ['لا يمكن أن تتجاوز نسبة الخصم 100٪.', 'The discount percentage cannot exceed 100%.'],
    VAT_CONTACT_NOT_FOUND: ['الجهة المختارة غير موجودة في المؤسسة.', 'The selected contact was not found in this organization.'],
    VAT_CONTACT_TYPE_MISMATCH: ['نوع الجهة لا يتوافق مع مبيعات أو مشتريات المستند.', 'This contact type does not match the document direction.'],
    INVALID_PERIOD_MONTH: ['اختر شهرًا صحيحًا للفترة.', 'Choose a valid period month.'],
  };
  return labels[code]?.[ar ? 0 : 1] ?? code;
}
