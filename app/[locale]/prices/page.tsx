'use client';

import { use, useEffect, useMemo, useState } from 'react';
import './prices.css';
import { organizationDisplayName } from '@/lib/organization-display';

type Organization = {
  id: string;
  name: string;
  parent_organization_id?: string | null;
  organization_kind?: 'HOLDING' | 'SUBSIDIARY';
  sort_order?: number;
};

type Currency = {
  code: string;
  name_ar: string;
  name_en: string;
  symbol: string | null;
  decimals: number;
  active: boolean;
};

type Price = {
  id: string;
  asset_type: string;
  karat?: number | null;
  price_per_unit: number;
  currency: string;
  valuation_date: string;
  source: string;
};

type FxRate = {
  id: string;
  organization_id: string | null;
  from_currency: string;
  to_currency: string;
  rate: number;
  valuation_date: string;
  source: string;
};

type Notice = { kind: 'success' | 'error'; text: string } | null;

const today = () => new Date().toISOString().slice(0, 10);

export default function Prices({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = use(params);
  const ar = locale === 'ar';
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [organizationId, setOrganizationId] = useState('');
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [prices, setPrices] = useState<Price[]>([]);
  const [fx, setFx] = useState<FxRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [ratesLoading, setRatesLoading] = useState(false);
  const [saving, setSaving] = useState<'price' | 'fx' | 'currency' | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [currencyDialog, setCurrencyDialog] = useState(false);

  const [priceDraft, setPriceDraft] = useState({
    asset_type: 'GOLD',
    karat: '24',
    price_per_unit: '',
    currency: 'SAR',
    valuation_date: today(),
    source: 'Manual',
  });
  const [fxDraft, setFxDraft] = useState({
    from_currency: 'USD',
    to_currency: 'SAR',
    rate: '',
    valuation_date: today(),
    source: 'Manual',
  });
  const [currencyDraft, setCurrencyDraft] = useState({
    code: '',
    name_ar: '',
    name_en: '',
    symbol: '',
    decimals: '2',
  });

  const sortedOrganizations = useMemo(
    () =>
      [...organizations].sort(
        (a, b) =>
          Number(a.sort_order ?? 100) - Number(b.sort_order ?? 100) ||
          a.name.localeCompare(b.name),
      ),
    [organizations],
  );

  const currencyOptions = useMemo(
    () =>
      currencies.map((currency) => ({
        value: currency.code,
        label: `${currency.code} — ${ar ? currency.name_ar : currency.name_en}`,
      })),
    [ar, currencies],
  );

  useEffect(() => {
    void loadCatalogs();
  }, []);

  useEffect(() => {
    if (organizationId) void loadRates(organizationId);
  }, [organizationId]);

  async function loadCatalogs() {
    setLoading(true);
    setNotice(null);
    const [organizationResult, currencyResult] = await Promise.all([
      fetchArray<Organization>('/api/organizations'),
      fetchArray<Currency>('/api/currencies'),
    ]);

    setOrganizations(organizationResult.rows);
    setCurrencies(currencyResult.rows);
    const chosen =
      organizationResult.rows.find(
        (organization) =>
          organization.organization_kind === 'HOLDING' &&
          !organization.parent_organization_id,
      ) ?? organizationResult.rows[0];

    if (chosen) setOrganizationId(chosen.id);
    if (currencyResult.error || organizationResult.error) {
      const error = currencyResult.error ?? organizationResult.error;
      setNotice({ kind: 'error', text: messageFor(error, ar) });
    }
    setLoading(false);
  }

  async function loadRates(selectedOrganizationId: string) {
    setRatesLoading(true);
    const [priceResult, fxResult] = await Promise.all([
      fetchArray<Price>('/api/prices'),
      fetchArray<FxRate>(
        `/api/fx?organization_id=${encodeURIComponent(selectedOrganizationId)}`,
      ),
    ]);

    setPrices(priceResult.rows);
    setFx(fxResult.rows);
    const error = priceResult.error ?? fxResult.error;
    if (error) setNotice({ kind: 'error', text: messageFor(error, ar) });
    setRatesLoading(false);
  }

  async function savePrice(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving('price');
    setNotice(null);
    try {
      const response = await fetch('/api/prices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...priceDraft,
          karat: priceDraft.asset_type === 'GOLD' ? Number(priceDraft.karat) : undefined,
          price_per_unit: Number(priceDraft.price_per_unit),
          currency: priceDraft.currency.toUpperCase(),
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || `HTTP_${response.status}`);

      setNotice({
        kind: 'success',
        text: ar ? 'تم حفظ السعر بنجاح.' : 'Price saved successfully.',
      });
      setPriceDraft((draft) => ({ ...draft, price_per_unit: '' }));
      if (organizationId) await loadRates(organizationId);
    } catch (error: any) {
      setNotice({ kind: 'error', text: messageFor(error.message, ar) });
    } finally {
      setSaving(null);
    }
  }

  async function saveFx(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId) {
      setNotice({ kind: 'error', text: messageFor('ORGANIZATION_ID_REQUIRED', ar) });
      return;
    }
    if (fxDraft.from_currency === fxDraft.to_currency) {
      setNotice({
        kind: 'error',
        text: ar ? 'اختر عملتين مختلفتين لسعر الصرف.' : 'Choose two different currencies.',
      });
      return;
    }

    setSaving('fx');
    setNotice(null);
    try {
      const response = await fetch('/api/fx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...fxDraft,
          organization_id: organizationId,
          rate: Number(fxDraft.rate),
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || `HTTP_${response.status}`);

      setNotice({
        kind: 'success',
        text: ar ? 'تم حفظ سعر الصرف لهذه المؤسسة.' : 'FX rate saved for this organization.',
      });
      setFxDraft((draft) => ({ ...draft, rate: '' }));
      await loadRates(organizationId);
    } catch (error: any) {
      setNotice({ kind: 'error', text: messageFor(error.message, ar) });
    } finally {
      setSaving(null);
    }
  }

  async function saveCurrency(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId) {
      setNotice({ kind: 'error', text: messageFor('ORGANIZATION_ID_REQUIRED', ar) });
      return;
    }

    setSaving('currency');
    setNotice(null);
    try {
      const code = currencyDraft.code.trim().toUpperCase();
      const response = await fetch('/api/currencies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...currencyDraft,
          code,
          organization_id: organizationId,
          decimals: Number(currencyDraft.decimals),
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || `HTTP_${response.status}`);

      const refreshed = await fetchArray<Currency>('/api/currencies');
      if (refreshed.error) throw new Error(refreshed.error);
      setCurrencies(refreshed.rows);
      setPriceDraft((draft) => ({ ...draft, currency: code }));
      setNotice({
        kind: 'success',
        text: ar
          ? `تمت إضافة ${code} إلى سجل العملات المشترك.`
          : `${code} was added to the shared currency catalog.`,
      });
      setCurrencyDraft({ code: '', name_ar: '', name_en: '', symbol: '', decimals: '2' });
      setCurrencyDialog(false);
    } catch (error: any) {
      setNotice({ kind: 'error', text: messageFor(error.message, ar) });
    } finally {
      setSaving(null);
    }
  }

  const selectedOrganization = organizations.find((item) => item.id === organizationId);

  return (
    <main className="container prices-page" dir={ar ? 'rtl' : 'ltr'}>
      <header className="prices-header">
        <div>
          <span className="prices-eyebrow">
            {ar ? 'البيانات المرجعية' : 'REFERENCE DATA'}
          </span>
          <h1>{ar ? 'الأسعار والعملات' : 'Prices & currencies'}</h1>
          <p>
            {ar
              ? 'إدارة مرجع العملات وأسعار السوق وأسعار الصرف التاريخية.'
              : 'Manage currency references, market prices and historical FX rates.'}
          </p>
        </div>
        <label className="prices-organization-picker">
          <span>{ar ? 'المؤسسة' : 'Organization'}</span>
          <select
            value={organizationId}
            onChange={(event) => setOrganizationId(event.target.value)}
            disabled={loading || organizations.length === 0}
          >
            {sortedOrganizations.map((organization) => (
              <option key={organization.id} value={organization.id}>
                {organizationDisplayName(organization.name, ar)}
              </option>
            ))}
          </select>
        </label>
      </header>

      {notice && (
        <div className={`prices-notice ${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
          <span aria-hidden="true">{notice.kind === 'success' ? '✓' : '!'}</span>
          {notice.text}
        </div>
      )}

      {loading ? (
        <div className="prices-loading" role="status">
          {ar ? 'جارٍ تحميل العملات والمؤسسات…' : 'Loading currencies and organizations…'}
        </div>
      ) : organizations.length === 0 ? (
        <section className="prices-empty card">
          <span aria-hidden="true">◈</span>
          <h2>{ar ? 'أضف مؤسسة أولًا' : 'Add an organization first'}</h2>
          <p>
            {ar
              ? 'تُحفظ أسعار الصرف لكل مؤسسة، لذلك يلزم وجود مؤسسة مرتبطة بحسابك.'
              : 'FX rates are stored per organization, so your account needs an organization first.'}
          </p>
          <a className="prices-button primary" href={`/${locale}/organizations`}>
            {ar ? 'إدارة المؤسسات' : 'Manage organizations'}
          </a>
        </section>
      ) : (
        <>
          <div className="prices-summary-row">
            <div className="prices-summary-card">
              <span className="prices-summary-icon">¤</span>
              <div>
                <small>{ar ? 'عملات نشطة' : 'Active currencies'}</small>
                <strong>{currencies.length}</strong>
              </div>
            </div>
            <div className="prices-summary-card">
              <span className="prices-summary-icon market">↗</span>
              <div>
                <small>{ar ? 'أسعار مسجلة' : 'Recorded prices'}</small>
                <strong>{prices.length}</strong>
              </div>
            </div>
            <div className="prices-summary-card">
              <span className="prices-summary-icon fx">⇄</span>
              <div>
                <small>{ar ? 'أسعار صرف للمؤسسة' : 'Organization FX rates'}</small>
                <strong>{fx.filter((rate) => rate.organization_id === organizationId).length}</strong>
              </div>
            </div>
            <div className="prices-summary-context">
              {ar ? 'النطاق الحالي' : 'Current scope'}
              <strong>
                {selectedOrganization
                  ? organizationDisplayName(selectedOrganization.name, ar)
                  : '—'}
              </strong>
            </div>
          </div>

          <div className="prices-form-grid">
            <section className="prices-panel card">
              <div className="prices-panel-heading">
                <div className="prices-panel-icon market">◈</div>
                <div>
                  <h2>{ar ? 'تسجيل سعر سوق' : 'Record a market price'}</h2>
                  <p>{ar ? 'مع تاريخ التقييم ومصدر السعر.' : 'Include the valuation date and source.'}</p>
                </div>
              </div>

              <form onSubmit={savePrice} className="prices-fields">
                <label>
                  <span>{ar ? 'نوع الأصل' : 'Asset type'}</span>
                  <select
                    value={priceDraft.asset_type}
                    onChange={(event) => setPriceDraft({ ...priceDraft, asset_type: event.target.value })}
                  >
                    <option value="GOLD">{ar ? 'ذهب' : 'Gold'}</option>
                    <option value="SILVER">{ar ? 'فضة' : 'Silver'}</option>
                    <option value="STOCK">{ar ? 'أسهم' : 'Stock'}</option>
                    <option value="OTHER">{ar ? 'أخرى' : 'Other'}</option>
                  </select>
                </label>
                {priceDraft.asset_type === 'GOLD' && (
                  <TextField
                    label={ar ? 'العيار' : 'Karat'}
                    type="number"
                    min="1"
                    max="24"
                    step="0.01"
                    required
                    value={priceDraft.karat}
                    onChange={(value) => setPriceDraft({ ...priceDraft, karat: value })}
                  />
                )}
                <TextField
                  label={ar ? 'السعر لكل وحدة' : 'Price per unit'}
                  type="number"
                  min="0.00000001"
                  step="any"
                  required
                  value={priceDraft.price_per_unit}
                  onChange={(value) => setPriceDraft({ ...priceDraft, price_per_unit: value })}
                />
                <SelectField
                  label={ar ? 'العملة' : 'Currency'}
                  value={priceDraft.currency}
                  options={currencyOptions}
                  onChange={(value) => setPriceDraft({ ...priceDraft, currency: value })}
                />
                <TextField
                  label={ar ? 'تاريخ التقييم' : 'Valuation date'}
                  type="date"
                  required
                  value={priceDraft.valuation_date}
                  onChange={(value) => setPriceDraft({ ...priceDraft, valuation_date: value })}
                />
                <TextField
                  label={ar ? 'مصدر السعر' : 'Price source'}
                  required
                  maxLength={120}
                  value={priceDraft.source}
                  onChange={(value) => setPriceDraft({ ...priceDraft, source: value })}
                />
                <button className="prices-button primary prices-form-action" disabled={saving !== null}>
                  {saving === 'price'
                    ? ar ? 'جارٍ الحفظ…' : 'Saving…'
                    : ar ? 'حفظ السعر' : 'Save price'}
                </button>
              </form>
            </section>

            <section className="prices-panel card">
              <div className="prices-panel-heading">
                <div className="prices-panel-icon fx">⇄</div>
                <div>
                  <h2>{ar ? 'تسجيل سعر صرف' : 'Record an FX rate'}</h2>
                  <p>
                    {ar
                      ? 'يُحفظ السعر للمؤسسة المحددة ولا يغيّر أسعار المؤسسات الأخرى.'
                      : 'Saved for the selected organization; other organizations keep their own rates.'}
                  </p>
                </div>
              </div>

              <form onSubmit={saveFx} className="prices-fields">
                <SelectField
                  label={ar ? 'من العملة' : 'From currency'}
                  value={fxDraft.from_currency}
                  options={currencyOptions}
                  onChange={(value) => setFxDraft({ ...fxDraft, from_currency: value })}
                />
                <SelectField
                  label={ar ? 'إلى العملة' : 'To currency'}
                  value={fxDraft.to_currency}
                  options={currencyOptions}
                  onChange={(value) => setFxDraft({ ...fxDraft, to_currency: value })}
                />
                <TextField
                  label={ar ? 'سعر التحويل' : 'Exchange rate'}
                  type="number"
                  min="0.000000000001"
                  step="any"
                  required
                  value={fxDraft.rate}
                  onChange={(value) => setFxDraft({ ...fxDraft, rate: value })}
                />
                <TextField
                  label={ar ? 'تاريخ السعر' : 'Rate date'}
                  type="date"
                  required
                  value={fxDraft.valuation_date}
                  onChange={(value) => setFxDraft({ ...fxDraft, valuation_date: value })}
                />
                <TextField
                  label={ar ? 'مصدر سعر الصرف' : 'Rate source'}
                  required
                  maxLength={120}
                  value={fxDraft.source}
                  onChange={(value) => setFxDraft({ ...fxDraft, source: value })}
                />
                <button className="prices-button primary prices-form-action" disabled={saving !== null}>
                  {saving === 'fx'
                    ? ar ? 'جارٍ الحفظ…' : 'Saving…'
                    : ar ? 'حفظ سعر الصرف' : 'Save FX rate'}
                </button>
              </form>
            </section>
          </div>

          <section className="prices-panel card prices-currency-panel">
            <div className="prices-section-heading">
              <div>
                <span className="prices-eyebrow">{ar ? 'سجل العملات' : 'CURRENCY CATALOG'}</span>
                <h2>{ar ? 'العملات النشطة' : 'Active currencies'}</h2>
                <p>
                  {ar
                    ? 'إضافة العملة تجعلها متاحة في القوائم لجميع مؤسسات المنصة.'
                    : 'Adding a currency makes it available in selectors across the platform.'}
                </p>
              </div>
              <button
                type="button"
                className="prices-button secondary"
                onClick={() => setCurrencyDialog(true)}
                disabled={!organizationId || saving !== null}
              >
                <span aria-hidden="true">＋</span>
                {ar ? 'إضافة عملة' : 'Add currency'}
              </button>
            </div>
            <div className="prices-table-wrap">
              <table className="prices-table">
                <thead>
                  <tr>
                    <th>{ar ? 'الرمز' : 'Code'}</th>
                    <th>{ar ? 'الاسم بالعربية' : 'Arabic name'}</th>
                    <th>{ar ? 'الاسم بالإنجليزية' : 'English name'}</th>
                    <th>{ar ? 'الرمز النقدي' : 'Symbol'}</th>
                    <th>{ar ? 'المنازل العشرية' : 'Decimals'}</th>
                  </tr>
                </thead>
                <tbody>
                  {currencies.map((currency) => (
                    <tr key={currency.code}>
                      <td><strong className="prices-code">{currency.code}</strong></td>
                      <td>{currency.name_ar}</td>
                      <td>{currency.name_en}</td>
                      <td>{currency.symbol || '—'}</td>
                      <td>{currency.decimals}</td>
                    </tr>
                  ))}
                  {!currencies.length && (
                    <tr><td colSpan={5} className="prices-table-empty">{ar ? 'لا توجد عملات نشطة.' : 'No active currencies.'}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="prices-panel card">
            <div className="prices-section-heading compact">
              <div>
                <h2>{ar ? 'الأسعار المسجلة' : 'Recorded prices'}</h2>
                <p>{ar ? 'أسعار السوق المرجعية مع تاريخها ومصدرها.' : 'Reference market prices with valuation date and source.'}</p>
              </div>
              {ratesLoading && <span className="prices-inline-loading">{ar ? 'تحديث…' : 'Refreshing…'}</span>}
            </div>
            <div className="prices-table-wrap">
              <table className="prices-table">
                <thead><tr><th>{ar ? 'نوع الأصل' : 'Asset type'}</th><th>{ar ? 'العيار' : 'Karat'}</th><th>{ar ? 'السعر' : 'Price'}</th><th>{ar ? 'العملة' : 'Currency'}</th><th>{ar ? 'التاريخ' : 'Date'}</th><th>{ar ? 'المصدر' : 'Source'}</th></tr></thead>
                <tbody>
                  {prices.map((price) => <tr key={price.id}><td>{assetLabel(price.asset_type, ar)}</td><td>{price.karat ?? '—'}</td><td>{price.price_per_unit}</td><td>{price.currency}</td><td>{price.valuation_date}</td><td>{price.source}</td></tr>)}
                  {!prices.length && <tr><td colSpan={6} className="prices-table-empty">{ratesLoading ? (ar ? 'جارٍ تحميل الأسعار…' : 'Loading prices…') : (ar ? 'لا توجد أسعار مسجلة.' : 'No prices recorded.')}</td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          <section className="prices-panel card">
            <div className="prices-section-heading compact">
              <div>
                <h2>{ar ? 'أسعار الصرف' : 'FX rates'}</h2>
                <p>{ar ? 'تظهر أسعار المؤسسة المحددة والأسعار المرجعية العامة.' : 'Shows the selected organization’s rates and global reference rates.'}</p>
              </div>
              {ratesLoading && <span className="prices-inline-loading">{ar ? 'تحديث…' : 'Refreshing…'}</span>}
            </div>
            <div className="prices-table-wrap">
              <table className="prices-table">
                <thead><tr><th>{ar ? 'زوج العملات' : 'Currency pair'}</th><th>{ar ? 'سعر التحويل' : 'Rate'}</th><th>{ar ? 'التاريخ' : 'Date'}</th><th>{ar ? 'المصدر' : 'Source'}</th><th>{ar ? 'النطاق' : 'Scope'}</th></tr></thead>
                <tbody>
                  {fx.map((rate) => <tr key={rate.id}><td><strong>{rate.from_currency}/{rate.to_currency}</strong></td><td>{rate.rate}</td><td>{rate.valuation_date}</td><td>{rate.source}</td><td><span className={`prices-scope ${rate.organization_id ? '' : 'global'}`}>{rate.organization_id ? (ar ? 'المؤسسة المحددة' : 'Selected organization') : (ar ? 'مرجع عام' : 'Global reference')}</span></td></tr>)}
                  {!fx.length && <tr><td colSpan={5} className="prices-table-empty">{ratesLoading ? (ar ? 'جارٍ تحميل أسعار الصرف…' : 'Loading FX rates…') : (ar ? 'لا توجد أسعار صرف مسجلة لهذه المؤسسة.' : 'No FX rates recorded for this organization.')}</td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          <p className="prices-scope-note">
            {ar
              ? 'سجل العملات مشترك بين المنصة، بينما أسعار الصرف اليدوية محفوظة لكل مؤسسة على حدة. إدارة العملات وأسعار الصرف متاحة لمالك المؤسسة أو مديرها.'
              : 'The currency catalog is shared platform-wide; manually entered FX rates are organization-specific. Currency and FX management is available to organization owners and admins.'}
          </p>
        </>
      )}

      {currencyDialog && (
        <div className="prices-modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && saving !== 'currency') setCurrencyDialog(false);
        }}>
          <section className="prices-modal card" role="dialog" aria-modal="true" aria-labelledby="currency-dialog-title">
            <div className="prices-modal-heading">
              <div>
                <span className="prices-eyebrow">{ar ? 'مرجع المنصة' : 'PLATFORM REFERENCE'}</span>
                <h2 id="currency-dialog-title">{ar ? 'إضافة عملة' : 'Add currency'}</h2>
              </div>
              <button type="button" className="prices-close" onClick={() => setCurrencyDialog(false)} aria-label={ar ? 'إغلاق' : 'Close'} disabled={saving === 'currency'}>×</button>
            </div>
            <p className="prices-modal-note">
              {ar
                ? 'استخدم رمزًا من ثلاثة أحرف مثل JPY، وأدخل الاسمين والرمز النقدي وعدد المنازل العشرية.'
                : 'Use a three-letter code such as JPY, then provide both names, the currency symbol and decimal places.'}
            </p>
            <form onSubmit={saveCurrency} className="prices-fields">
              <TextField label={ar ? 'رمز العملة' : 'Currency code'} value={currencyDraft.code} onChange={(value) => setCurrencyDraft({ ...currencyDraft, code: value.toUpperCase() })} minLength={3} maxLength={3} pattern="[A-Za-z]{3}" required autoCapitalize="characters" />
              <TextField label={ar ? 'الاسم بالعربية' : 'Arabic name'} value={currencyDraft.name_ar} onChange={(value) => setCurrencyDraft({ ...currencyDraft, name_ar: value })} required dir="rtl" />
              <TextField label={ar ? 'الاسم بالإنجليزية' : 'English name'} value={currencyDraft.name_en} onChange={(value) => setCurrencyDraft({ ...currencyDraft, name_en: value })} required dir="ltr" />
              <TextField label={ar ? 'الرمز النقدي' : 'Currency symbol'} value={currencyDraft.symbol} onChange={(value) => setCurrencyDraft({ ...currencyDraft, symbol: value })} maxLength={12} />
              <TextField label={ar ? 'المنازل العشرية (0–4)' : 'Decimal places (0–4)'} type="number" min="0" max="4" step="1" required value={currencyDraft.decimals} onChange={(value) => setCurrencyDraft({ ...currencyDraft, decimals: value })} />
              <div className="prices-modal-actions">
                <button type="button" className="prices-button secondary" onClick={() => setCurrencyDialog(false)} disabled={saving === 'currency'}>{ar ? 'إلغاء' : 'Cancel'}</button>
                <button className="prices-button primary" disabled={saving !== null}>{saving === 'currency' ? (ar ? 'جارٍ الإضافة…' : 'Adding…') : (ar ? 'إضافة إلى السجل' : 'Add to catalog')}</button>
              </div>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}

function TextField({
  label,
  value,
  onChange,
  type = 'text',
  required = false,
  min,
  max,
  step,
  minLength,
  maxLength,
  pattern,
  autoCapitalize,
  dir,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
  min?: string;
  max?: string;
  step?: string;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  autoCapitalize?: string;
  dir?: 'rtl' | 'ltr';
}) {
  return (
    <label>
      <span>{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        min={min}
        max={max}
        step={step}
        minLength={minLength}
        maxLength={maxLength}
        pattern={pattern}
        autoCapitalize={autoCapitalize}
        dir={dir}
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} required>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

async function fetchArray<T>(url: string): Promise<{ rows: T[]; error?: string }> {
  try {
    const response = await fetch(url, { cache: 'no-store' });
    const body = await response.json().catch(() => null);
    if (!response.ok || !Array.isArray(body)) {
      return {
        rows: [],
        error: typeof body?.error === 'string' ? body.error : `HTTP_${response.status}`,
      };
    }
    return { rows: body };
  } catch {
    return { rows: [], error: 'NETWORK_ERROR' };
  }
}

function assetLabel(type: string, ar: boolean) {
  const labels: Record<string, [string, string]> = {
    GOLD: ['ذهب', 'Gold'],
    SILVER: ['فضة', 'Silver'],
    STOCK: ['أسهم', 'Stock'],
    OTHER: ['أخرى', 'Other'],
  };
  return labels[type]?.[ar ? 0 : 1] ?? type;
}

function messageFor(code: string | undefined, ar: boolean) {
  const messages: Record<string, [string, string]> = {
    UNAUTHORIZED: ['انتهت جلسة الدخول. سجّل الدخول ثم أعد المحاولة.', 'Your session expired. Sign in and try again.'],
    ORGANIZATION_ADMIN_REQUIRED: ['تحتاج إلى صلاحية مالك المؤسسة أو مديرها لإدارة العملات وأسعار الصرف.', 'Only an organization owner or admin can manage currencies and FX rates.'],
    CURRENCY_CODE_ALREADY_EXISTS: ['رمز العملة مسجل مسبقًا.', 'That currency code is already registered.'],
    CURRENCY_NOT_ACTIVE: ['اختر عملة نشطة من سجل العملات.', 'Choose an active currency from the catalog.'],
    ORGANIZATION_ID_REQUIRED: ['اختر مؤسسة أولًا.', 'Select an organization first.'],
    FX_CURRENCIES_MUST_DIFFER: ['يجب أن تكون عملتا التحويل مختلفتين.', 'The source and target currencies must differ.'],
    NETWORK_ERROR: ['تعذر الاتصال بالخادم. تحقق من الاتصال ثم حاول مجددًا.', 'Could not reach the server. Check your connection and try again.'],
  };
  if (code && messages[code]) return messages[code][ar ? 0 : 1];
  return code || (ar ? 'تعذر إكمال العملية.' : 'The operation could not be completed.');
}
