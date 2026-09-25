'use client';

import { FormEvent, useEffect, useState } from 'react';
import { emptyVatPeriodSummary, VAT_SUMMARY_AMOUNT_FIELDS, type VatPeriodSummaryInputs, type VatPeriodSummaryRecord } from '@/lib/vat-period-summary';

type Totals = {
  salesBase: string;
  salesGross: string;
  purchaseBase: string;
  purchaseVatBeforeRecovery: string;
  outputTax: string;
  inputTax: string;
  taxPayable: string;
  taxCredit: string;
  salesNet: string;
  purchaseNet: string;
  paidAmount: string;
  cashReservedAmount: string;
  filingStatus?: string;
  dueDate?: string;
  zeroRatedSales: string;
  exemptSales: string;
  outOfScopeSales: string;
};

type Props = {
  organizationId: string;
  period: { from: string; to: string };
  yearStart: string;
  frequency: 'MONTHLY' | 'QUARTERLY';
  periodSummary: (VatPeriodSummaryRecord & Record<string, any>) | null;
  periodTotals: Totals;
  annualTotals: Totals;
  standardRate: number;
  registered: boolean;
  ar: boolean;
  onSaved: () => void;
};

const text = (value: unknown) => String(value ?? '0');
const amount = (value: string | number) => Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const todayInRiyadh = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date());

export function VatPeriodSummaryForm({ organizationId, period, periodSummary, standardRate, registered, ar, onSaved }: Props) {
  const [inputs, setInputs] = useState<VatPeriodSummaryInputs>(() => valuesFrom(periodSummary));
  const [filingStatus, setFilingStatus] = useState<'NOT_FILED' | 'FILED'>(periodSummary?.filing_status ?? 'NOT_FILED');
  const [filedAt, setFiledAt] = useState(periodSummary?.filed_at ?? '');
  const [filingReference, setFilingReference] = useState(periodSummary?.filing_reference ?? '');
  const [paidAmount, setPaidAmount] = useState(text(periodSummary?.paid_amount));
  const [paidAt, setPaidAt] = useState(periodSummary?.paid_at ?? '');
  const [paymentReference, setPaymentReference] = useState(periodSummary?.payment_reference ?? '');
  const [cashReservedAmount, setCashReservedAmount] = useState(text(periodSummary?.cash_reserved_amount));
  const [notes, setNotes] = useState(periodSummary?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null);

  useEffect(() => {
    setInputs(valuesFrom(periodSummary));
    setFilingStatus(periodSummary?.filing_status ?? 'NOT_FILED');
    setFiledAt(periodSummary?.filed_at ?? '');
    setFilingReference(periodSummary?.filing_reference ?? '');
    setPaidAmount(text(periodSummary?.paid_amount));
    setPaidAt(periodSummary?.paid_at ?? '');
    setPaymentReference(periodSummary?.payment_reference ?? '');
    setCashReservedAmount(text(periodSummary?.cash_reserved_amount));
    setNotes(periodSummary?.notes ?? '');
  }, [periodSummary, period.from, period.to]);

  const outputVat = Number(inputs.sales_standard_base || 0) * standardRate / 100
    + Number(inputs.reverse_charge_base || 0) * standardRate / 100;
  const purchaseVat = Number(inputs.purchases_standard_base || 0) * standardRate / 100
    + Number(inputs.imports_vat_paid || 0)
    + Number(inputs.reverse_charge_base || 0) * standardRate / 100;
  const recoverableVat = purchaseVat * Number(inputs.input_tax_recoverable_percent || 0) / 100;
  const estimatedDue = Math.max(0, outputVat - recoverableVat);
  const currentOutstanding = Math.max(0, estimatedDue - Number(paidAmount || 0));
  const cashGap = Math.max(0, currentOutstanding - Number(cashReservedAmount || 0));

  function setNumber(key: keyof VatPeriodSummaryInputs, value: string) {
    setInputs((current) => ({ ...current, [key]: value }));
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    const actualFilingDate = filingStatus === 'FILED' ? filedAt || todayInRiyadh() : null;
    const actualPaymentDate = Number(paidAmount) > 0 ? paidAt || todayInRiyadh() : null;
    try {
      const response = await fetch('/api/vat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save_period_summary',
          organization_id: organizationId,
          period_start: period.from,
          period_end: period.to,
          ...inputs,
          filing_status: filingStatus,
          filed_at: actualFilingDate,
          filing_reference: filingReference || null,
          paid_amount: Number(paidAmount || 0),
          paid_at: actualPaymentDate,
          payment_reference: paymentReference || null,
          cash_reserved_amount: Number(cashReservedAmount || 0),
          notes: notes || null,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || `HTTP_${response.status}`);
      setNotice({ error: false, text: ar ? 'تم حفظ إجماليات الفترة وحالة الإقرار والسداد.' : 'Period totals and filing/payment status saved.' });
      onSaved();
    } catch (error) {
      setNotice({ error: true, text: messageFor(error instanceof Error ? error.message : 'UNKNOWN_ERROR', ar) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="vat-panel">
      <div className="vat-panel-head">
        <div>
          <span className="vat-eyebrow">{ar ? 'إدخال إجمالي الفترة' : 'PERIOD TOTALS INPUT'}</span>
          <h2>{ar ? 'إدخال ملخص المبيعات والمشتريات' : 'Enter sales and purchase totals'}</h2>
          <p>{ar ? 'أدخل الإجماليات للفترة المحددة. تُستخدم هذه البيانات بدلًا من تفاصيل الفواتير المسجلة للفترة نفسها لتجنب احتسابها مرتين.' : 'Enter totals for the selected period. These totals replace detailed invoice entries for that period in the dashboard to prevent double counting.'}</p>
        </div>
      </div>
      {!registered && <div className="vat-inline-warning">{ar ? 'أكمل تسجيل ضريبة القيمة المضافة قبل حفظ إجماليات الفترة.' : 'Complete VAT registration before saving period totals.'}</div>}
      {notice && <div className={`vat-notice ${notice.error ? 'error' : 'success'}`} role={notice.error ? 'alert' : 'status'}>{notice.text}</div>}
      <form className="vat-period-summary-form" onSubmit={save}>
        <fieldset className="vat-summary-group">
          <legend>{ar ? 'المبيعات' : 'Sales'}</legend>
          <div className="vat-summary-grid">
            <AmountField label={ar ? `خاضعة للنسبة الأساسية ${standardRate}%` : `Standard-rated ${standardRate}%`} value={text(inputs.sales_standard_base)} onChange={(value) => setNumber('sales_standard_base', value)} hint={ar ? 'يحسب النظام ضريبة المخرجات تلقائيًا.' : 'Output VAT is calculated automatically.'} />
            <AmountField label={ar ? 'خاضعة للنسبة الصفرية' : 'Zero-rated'} value={text(inputs.sales_zero_rated_base)} onChange={(value) => setNumber('sales_zero_rated_base', value)} />
            <AmountField label={ar ? 'معفاة' : 'Exempt'} value={text(inputs.sales_exempt_base)} onChange={(value) => setNumber('sales_exempt_base', value)} />
            <AmountField label={ar ? 'خارج النطاق' : 'Out of scope'} value={text(inputs.sales_out_of_scope_base)} onChange={(value) => setNumber('sales_out_of_scope_base', value)} />
          </div>
        </fieldset>

        <fieldset className="vat-summary-group">
          <legend>{ar ? 'المشتريات والمدخلات' : 'Purchases and input VAT'}</legend>
          <div className="vat-summary-grid">
            <AmountField label={ar ? `خاضعة للنسبة الأساسية ${standardRate}%` : `Standard-rated ${standardRate}%`} value={text(inputs.purchases_standard_base)} onChange={(value) => setNumber('purchases_standard_base', value)} hint={ar ? 'تُحسب الضريبة على الأساس المسجل.' : 'VAT is calculated from the entered base.'} />
            <AmountField label={ar ? 'خاضعة للنسبة الصفرية' : 'Zero-rated'} value={text(inputs.purchases_zero_rated_base)} onChange={(value) => setNumber('purchases_zero_rated_base', value)} />
            <AmountField label={ar ? 'معفاة' : 'Exempt'} value={text(inputs.purchases_exempt_base)} onChange={(value) => setNumber('purchases_exempt_base', value)} />
            <AmountField label={ar ? 'خارج النطاق' : 'Out of scope'} value={text(inputs.purchases_out_of_scope_base)} onChange={(value) => setNumber('purchases_out_of_scope_base', value)} />
            <AmountField label={ar ? 'أساس استيراد السلع' : 'Imported goods base'} value={text(inputs.imports_goods_base)} onChange={(value) => setNumber('imports_goods_base', value)} hint={ar ? 'يُضاف لقيمة المشتريات؛ أدخل ضريبة الجمارك الفعلية في الحقل التالي.' : 'Included in purchases; enter actual customs VAT below.'} />
            <AmountField label={ar ? 'ضريبة الاستيراد المدفوعة' : 'Import VAT paid'} value={text(inputs.imports_vat_paid)} onChange={(value) => setNumber('imports_vat_paid', value)} />
            <AmountField label={ar ? 'خدمات خاضعة للاحتساب العكسي' : 'Reverse-charge services base'} value={text(inputs.reverse_charge_base)} onChange={(value) => setNumber('reverse_charge_base', value)} hint={ar ? 'تُضاف ضريبتها إلى المخرجات والمدخلات القابلة للخصم.' : 'Calculated in output and recoverable input VAT.'} />
            <label className="vat-summary-field"><span>{ar ? 'نسبة ضريبة المدخلات القابلة للخصم' : 'Recoverable input VAT percentage'}</span><div className="vat-percent-input"><input required type="number" min="0" max="100" step="0.01" value={text(inputs.input_tax_recoverable_percent)} onChange={(event) => setNumber('input_tax_recoverable_percent', event.target.value)} /><span>%</span></div><small>{ar ? 'تُطبق على ضريبة المشتريات والاستيراد والاحتساب العكسي.' : 'Applied to purchase, import and reverse-charge VAT.'}</small></label>
          </div>
        </fieldset>

        <section className="vat-summary-preview" aria-live="polite">
          <strong>{ar ? 'احتساب أولي للفترة' : 'Period calculation preview'}</strong>
          <span>{ar ? 'ضريبة المخرجات' : 'Output VAT'} <b>{amount(outputVat)} SAR</b></span>
          <span>{ar ? 'ضريبة المدخلات القابلة للخصم' : 'Recoverable input VAT'} <b>{amount(recoverableVat)} SAR</b></span>
          <span>{ar ? 'المستحق التقديري' : 'Estimated payable'} <b>{amount(estimatedDue)} SAR</b></span>
          {Number(paidAmount) > 0 && <span>{ar ? 'المتبقي بعد السداد' : 'Outstanding after payments'} <b>{amount(currentOutstanding)} SAR</b></span>}
          {Number(cashReservedAmount) > 0 && <span className={cashGap > 0 ? 'shortfall' : 'covered'}>{ar ? 'فجوة السيولة المخصصة' : 'Cash reserve gap'} <b>{amount(cashGap)} SAR</b></span>}
        </section>

        <fieldset className="vat-summary-group">
          <legend>{ar ? 'الإقرار والسداد والسيولة' : 'Return, payment and cash reserve'}</legend>
          <div className="vat-summary-grid">
            <label className="vat-summary-field"><span>{ar ? 'حالة الإقرار' : 'Return status'}</span><select value={filingStatus} onChange={(event) => { const value = event.target.value as typeof filingStatus; setFilingStatus(value); if (value === 'FILED' && !filedAt) setFiledAt(todayInRiyadh()); }}>{option('NOT_FILED', ar ? 'لم يقدم بعد' : 'Not filed')}{option('FILED', ar ? 'تم تقديمه في زاتكا' : 'Filed with ZATCA')}</select></label>
            {filingStatus === 'FILED' && <>
              <label className="vat-summary-field"><span>{ar ? 'تاريخ التقديم' : 'Filing date'}</span><input required type="date" value={filedAt} onChange={(event) => setFiledAt(event.target.value)} /></label>
              <label className="vat-summary-field"><span>{ar ? 'مرجع الإقرار (اختياري)' : 'Return reference (optional)'}</span><input maxLength={120} value={filingReference} onChange={(event) => setFilingReference(event.target.value)} /></label>
            </>}
            <AmountField label={ar ? 'المبلغ المسدد' : 'Amount paid'} value={paidAmount} onChange={setPaidAmount} />
            {Number(paidAmount) > 0 && <>
              <label className="vat-summary-field"><span>{ar ? 'تاريخ السداد' : 'Payment date'}</span><input required type="date" value={paidAt} onChange={(event) => setPaidAt(event.target.value)} /></label>
              <label className="vat-summary-field"><span>{ar ? 'مرجع السداد (اختياري)' : 'Payment reference (optional)'}</span><input maxLength={120} value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} /></label>
            </>}
            <AmountField label={ar ? 'السيولة المحجوزة للسداد' : 'Cash reserved for VAT'} value={cashReservedAmount} onChange={setCashReservedAmount} hint={ar ? 'تُقارن بالرصيد المتبقي لتنبيه الإدارة عن النقص.' : 'Compared with the outstanding balance to flag a shortfall.'} />
            <label className="vat-summary-field vat-summary-notes"><span>{ar ? 'ملاحظات' : 'Notes'}</span><input maxLength={1000} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
          </div>
        </fieldset>
        <div className="vat-form-actions"><button className="vat-button primary" disabled={!registered || busy}>{busy ? (ar ? 'جارٍ الحفظ…' : 'Saving…') : (ar ? 'حفظ إجماليات الفترة' : 'Save period totals')}</button></div>
      </form>
    </section>
  );
}

export function VatManagementDashboard({ period, yearStart, frequency, periodSummary, periodTotals, annualTotals, ar }: Props) {
  const today = todayInRiyadh();
  const daysToDue = daysBetween(today, periodTotals.dueDate ?? period.to);
  const periodOutstanding = Math.max(0, Number(periodTotals.taxPayable) - Number(periodTotals.paidAmount));
  const periodCashGap = Math.max(0, periodOutstanding - Number(periodTotals.cashReservedAmount));
  const annualOutstanding = Math.max(0, Number(annualTotals.taxPayable) - Number(annualTotals.paidAmount));
  const isPaid = Number(periodTotals.taxPayable) === 0 || periodOutstanding <= 0;
  const isOverdue = !isPaid && daysToDue < 0;
  const dueSoon = !isPaid && daysToDue >= 0 && daysToDue <= 7;
  const filingLabel = periodTotals.filingStatus === 'FILED' ? (ar ? 'تم تقديم الإقرار' : 'Return filed') : (ar ? 'بانتظار تقديم الإقرار' : 'Return not filed');

  return <>
    <section className="vat-panel vat-dashboard-alert vat-dashboard-hero">
      <div className="vat-dashboard-alert-copy">
        <span className={`vat-dashboard-state ${isPaid ? 'paid' : isOverdue ? 'overdue' : dueSoon ? 'soon' : 'upcoming'}`}>
          <VatIcon name="calendar" />
          {isPaid ? (ar ? 'لا يوجد مبلغ مستحق للسداد' : 'No payment outstanding') : isOverdue ? (ar ? 'متأخر عن موعد السداد' : 'Payment overdue') : dueSoon ? (ar ? `الاستحقاق خلال ${daysToDue} يوم` : `Due in ${daysToDue} days`) : (ar ? 'موعد السداد قادم' : 'Upcoming due date')}
        </span>
        <h2>{ar ? 'استحقاق ضريبة الفترة' : 'Current period VAT due'}</h2>
        <p>{ar ? `آخر موعد للتقديم والسداد ${formatDate(periodTotals.dueDate ?? period.to, ar)}. المستحق بعد السداد: ${amount(periodOutstanding)} ريال.` : `File and pay by ${formatDate(periodTotals.dueDate ?? period.to, ar)}. Outstanding after payments: SAR ${amount(periodOutstanding)}.`}</p>
      </div>
      <div className="vat-dashboard-alert-amount"><small>{ar ? 'المبلغ المستحق' : 'Amount due'}</small><strong>{amount(periodTotals.taxPayable)} SAR</strong><small>{filingLabel}</small></div>
      {Number(periodTotals.taxPayable) > 0 && <div className={`vat-cash-alert ${periodCashGap > 0 ? 'shortfall' : 'covered'}`} role="status">
        {periodCashGap > 0
          ? (ar ? `السيولة المخصصة أقل من المتبقي بمبلغ ${amount(periodCashGap)} ريال. يُنصح بتأمينه قبل ${formatDate(periodTotals.dueDate ?? period.to, ar)}.` : `Reserved cash is short by SAR ${amount(periodCashGap)}. Secure the difference before ${formatDate(periodTotals.dueDate ?? period.to, ar)}.`)
          : (ar ? 'السيولة المخصصة تغطي المبلغ المتبقي المسجل.' : 'The recorded cash reserve covers the outstanding amount.')}
      </div>}
    </section>

    <VatFinancialGraphics periodTotals={periodTotals} ar={ar} />

    <section className="vat-dashboard-section">
      <div className="vat-dashboard-section-head"><div><span className="vat-eyebrow">{ar ? 'الفترة المحددة' : 'SELECTED PERIOD'}</span><h2>{period.from} — {period.to}</h2></div><span className="vat-period-chip">{frequency === 'MONTHLY' ? (ar ? 'شهري' : 'Monthly') : (ar ? 'ربع سنوي' : 'Quarterly')}</span></div>
      <div className="vat-dashboard-groups">
        <MetricRow title={ar ? 'المبيعات' : 'Sales'} tone="sales" ar={ar} icon="chart" metrics={[
          { icon: 'coins', label: ar ? 'إجمالي المبيعات قبل الضريبة' : 'Sales before VAT', value: `${amount(periodTotals.salesBase)} SAR` },
          { icon: 'receipt', label: ar ? 'إجمالي المبيعات شامل الضريبة' : 'Sales including VAT', value: `${amount(periodTotals.salesGross)} SAR` },
          { icon: 'percent', label: ar ? 'ضريبة المخرجات' : 'Output VAT', value: `${amount(periodTotals.outputTax)} SAR` },
        ]} />
        <MetricRow title={ar ? 'المشتريات' : 'Purchases'} tone="purchases" ar={ar} icon="bag" metrics={[
          { icon: 'cart', label: ar ? 'إجمالي المشتريات قبل الضريبة' : 'Purchases before VAT', value: `${amount(periodTotals.purchaseBase)} SAR` },
          { icon: 'receipt', label: ar ? 'ضريبة المشتريات قبل الاسترداد' : 'Purchase VAT before recovery', value: `${amount(periodTotals.purchaseVatBeforeRecovery)} SAR` },
          { icon: 'shield', label: ar ? 'ضريبة المدخلات القابلة للخصم' : 'Recoverable input VAT', value: `${amount(periodTotals.inputTax)} SAR` },
        ]} />
        <MetricRow title={ar ? 'الموقف الضريبي والسداد' : 'Tax position and settlement'} tone="settlement" ar={ar} icon="scale" metrics={[
          { icon: 'calculator', kind: 'due', label: ar ? 'صافي الضريبة المستحقة' : 'Net VAT payable', value: `${amount(periodTotals.taxPayable)} SAR`, emphasis: true },
          { icon: 'credit', kind: 'credit', label: ar ? 'رصيد ضريبي' : 'VAT credit', value: `${amount(periodTotals.taxCredit)} SAR` },
          { icon: 'check', kind: 'paid', label: ar ? 'المسدد' : 'Paid', value: `${amount(periodTotals.paidAmount)} SAR` },
          { icon: 'clock', kind: 'outstanding', label: ar ? 'المتبقي بعد السداد' : 'Outstanding', value: `${amount(periodOutstanding)} SAR` },
          { icon: 'wallet', kind: 'reserve', label: ar ? 'السيولة المحجوزة' : 'Cash reserved', value: `${amount(periodTotals.cashReservedAmount)} SAR` },
        ]} />
      </div>
    </section>

    <section className="vat-panel vat-annual-dashboard">
      <div className="vat-dashboard-section-head"><div><span className="vat-eyebrow">{ar ? 'من بداية السنة الضريبية' : 'TAX YEAR TO DATE'}</span><h2>{formatDate(yearStart, ar)} — {period.to}</h2></div></div>
      <div className="vat-dashboard-groups">
        <MetricRow title={ar ? 'المبيعات' : 'Sales'} tone="sales" ar={ar} icon="chart" metrics={[
          { icon: 'coins', label: ar ? 'إجمالي المبيعات قبل الضريبة' : 'Sales before VAT', value: `${amount(annualTotals.salesBase)} SAR` },
          { icon: 'receipt', label: ar ? 'إجمالي المبيعات شامل الضريبة' : 'Sales including VAT', value: `${amount(annualTotals.salesGross)} SAR` },
          { icon: 'percent', label: ar ? 'ضريبة المخرجات' : 'Output VAT', value: `${amount(annualTotals.outputTax)} SAR` },
        ]} />
        <MetricRow title={ar ? 'المشتريات' : 'Purchases'} tone="purchases" ar={ar} icon="bag" metrics={[
          { icon: 'cart', label: ar ? 'إجمالي المشتريات قبل الضريبة' : 'Purchases before VAT', value: `${amount(annualTotals.purchaseBase)} SAR` },
          { icon: 'receipt', label: ar ? 'ضريبة المشتريات قبل الاسترداد' : 'Purchase VAT before recovery', value: `${amount(annualTotals.purchaseVatBeforeRecovery)} SAR` },
          { icon: 'shield', label: ar ? 'ضريبة المدخلات القابلة للخصم' : 'Recoverable input VAT', value: `${amount(annualTotals.inputTax)} SAR` },
        ]} />
        <MetricRow title={ar ? 'الموقف الضريبي والسداد' : 'Tax position and settlement'} tone="settlement" ar={ar} icon="scale" metrics={[
          { icon: 'calculator', kind: 'due', label: ar ? 'صافي المستحق حتى تاريخه' : 'Net tax due to date', value: `${amount(annualTotals.taxPayable)} SAR`, emphasis: true },
          { icon: 'credit', kind: 'credit', label: ar ? 'رصيد ضريبي' : 'VAT credit', value: `${amount(annualTotals.taxCredit)} SAR` },
          { icon: 'check', kind: 'paid', label: ar ? 'المسدد خلال السنة' : 'Paid year to date', value: `${amount(annualTotals.paidAmount)} SAR` },
          { icon: 'clock', kind: 'outstanding', label: ar ? 'المتبقي السنوي' : 'Year-to-date outstanding', value: `${amount(annualOutstanding)} SAR` },
          { icon: 'wallet', kind: 'reserve', label: ar ? 'السيولة المحجوزة للسنة' : 'Year-to-date cash reserved', value: `${amount(annualTotals.cashReservedAmount)} SAR` },
        ]} />
      </div>
      {!periodSummary && <p className="vat-dashboard-source-note">{ar ? 'لم تُحفظ إجماليات يدوية لهذه الفترة بعد؛ يعرض النظام ما سجّلته في سجل المستندات. أدخل إجماليات الفترة من تبويب «إجماليات الفترة» إذا كانت بياناتك مجمعة.' : 'No aggregate totals are saved for this period yet; the dashboard uses the document register. Enter period totals in the “Period totals” tab if you report aggregated figures.'}</p>}
    </section>
  </>;
}

function VatFinancialGraphics({ periodTotals, ar }: { periodTotals: Totals; ar: boolean }) {
  const sales = Number(periodTotals.salesBase);
  const purchases = Number(periodTotals.purchaseBase);
  const output = Number(periodTotals.outputTax);
  const input = Number(periodTotals.inputTax);
  const due = Number(periodTotals.taxPayable);
  const paid = Math.min(due, Number(periodTotals.paidAmount));
  const outstanding = Math.max(0, due - paid);
  const reserved = Math.min(outstanding, Number(periodTotals.cashReservedAmount));
  const salesScale = Math.max(sales, purchases, 1);
  const taxScale = Math.max(output, input, 1);
  const paidPercent = due > 0 ? Math.min(100, paid / due * 100) : 100;
  const reservePercent = outstanding > 0 ? Math.min(100, reserved / outstanding * 100) : 100;

  return <section className="vat-visual-grid" aria-label={ar ? 'رسوم توضيحية للفترة' : 'Period financial graphics'}>
    <article className="vat-visual-card">
      <div className="vat-visual-heading"><span className="vat-visual-icon sales-icon"><VatIcon name="chart" /></span><div><h3>{ar ? 'حركة المبيعات والمشتريات' : 'Sales and purchases'}</h3><p>{ar ? 'مقارنة صافي القيم للفترة' : 'Net value comparison for this period'}</p></div></div>
      <VisualBar label={ar ? 'المبيعات' : 'Sales'} value={sales} percent={sales / salesScale * 100} color="green" />
      <VisualBar label={ar ? 'المشتريات' : 'Purchases'} value={purchases} percent={purchases / salesScale * 100} color="blue" />
      <div className="vat-visual-footnote">{ar ? 'القيم قبل ضريبة القيمة المضافة' : 'Amounts exclude VAT'}</div>
    </article>

    <article className="vat-visual-card">
      <div className="vat-visual-heading"><span className="vat-visual-icon tax-icon"><VatIcon name="percent" /></span><div><h3>{ar ? 'مقارنة الضريبة' : 'VAT comparison'}</h3><p>{ar ? 'مخرجات المبيعات ومدخلات المشتريات' : 'Output tax and recoverable input tax'}</p></div></div>
      <VisualBar label={ar ? 'ضريبة المخرجات' : 'Output VAT'} value={output} percent={output / taxScale * 100} color="amber" />
      <VisualBar label={ar ? 'المدخلات القابلة للخصم' : 'Recoverable input'} value={input} percent={input / taxScale * 100} color="teal" />
      <div className="vat-visual-net"><span>{ar ? 'صافي المستحق' : 'Net payable'}</span><strong>{amount(periodTotals.taxPayable)} SAR</strong><small>{ar ? 'رصيد ضريبي' : 'Tax credit'}: {amount(periodTotals.taxCredit)} SAR</small></div>
    </article>

    <article className="vat-visual-card vat-settlement-card">
      <div className="vat-visual-heading"><span className="vat-visual-icon cash-icon"><VatIcon name="wallet" /></span><div><h3>{ar ? 'تغطية الاستحقاق' : 'Settlement coverage'}</h3><p>{ar ? 'السداد والسيولة المحجوزة' : 'Payments and reserved cash'}</p></div></div>
      <div className="vat-progress-label"><span>{ar ? 'المسدد من الضريبة' : 'VAT paid'}</span><strong>{amount(periodTotals.paidAmount)} / {amount(periodTotals.taxPayable)} SAR</strong></div>
      <div className="vat-progress-track" role="img" aria-label={ar ? `تم سداد ${Math.round(paidPercent)} بالمئة من المستحق` : `${Math.round(paidPercent)} percent of VAT due paid`}><span className="paid-progress" style={{ width: `${paidPercent}%` }} /></div>
      <div className="vat-progress-label"><span>{ar ? 'السيولة المحجوزة من المتبقي' : 'Cash reserved for outstanding'}</span><strong>{amount(periodTotals.cashReservedAmount)} / {amount(outstanding)} SAR</strong></div>
      <div className="vat-progress-track" role="img" aria-label={ar ? `تغطي السيولة المحجوزة ${Math.round(reservePercent)} بالمئة من المتبقي` : `Reserved cash covers ${Math.round(reservePercent)} percent of the outstanding amount`}><span className="cash-progress" style={{ width: `${reservePercent}%` }} /></div>
      <div className="vat-visual-footnote">{ar ? 'تُحدّث هذه القيم عند تسجيل السداد أو تعديل السيولة المحجوزة.' : 'Updated when payment or cash reserve figures are recorded.'}</div>
    </article>
  </section>;
}

function VisualBar({ label, value, percent, color }: { label: string; value: number; percent: number; color: string }) {
  return <div className="vat-visual-bar-row">
    <div className="vat-visual-bar-copy"><span>{label}</span><strong>{amount(value)} SAR</strong></div>
    <div className="vat-visual-track" role="img" aria-label={`${label}: ${amount(value)} SAR`}><span className={`vat-visual-bar ${color}`} style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} /></div>
  </div>;
}

function AmountField({ label, value, onChange, hint }: { label: string; value: string; onChange: (value: string) => void; hint?: string }) {
  return <label className="vat-summary-field"><span>{label}</span><div className="vat-money-input"><input required type="number" min="0" step="0.01" value={value} onChange={(event) => onChange(event.target.value)} /><span>SAR</span></div>{hint && <small>{hint}</small>}</label>;
}

type VatIconName = 'chart' | 'bag' | 'scale' | 'coins' | 'receipt' | 'percent' | 'cart' | 'shield' | 'calculator' | 'credit' | 'check' | 'clock' | 'wallet' | 'calendar';

function VatIcon({ name }: { name: VatIconName }) {
  const shared = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  const drawings: Record<VatIconName, React.ReactNode> = {
    chart: <><path d="M4 18V5" /><path d="M4 18h16" /><path d="m7 14 4-4 3 2 5-6" /><path d="M16 6h3v3" /></>,
    bag: <><path d="M5 8h14l1 12H4L5 8Z" /><path d="M9 8V6a3 3 0 0 1 6 0v2" /></>,
    scale: <><path d="M12 3v18" /><path d="M5 6h14" /><path d="m5 6-3 6h6L5 6Z" /><path d="m19 6-3 6h6l-3-6Z" /><path d="M8 21h8" /></>,
    coins: <><ellipse cx="9" cy="7" rx="6" ry="3" /><path d="M3 7v5c0 1.7 2.7 3 6 3 1.1 0 2.1-.2 3-.5" /><path d="M3 12v5c0 1.7 2.7 3 6 3 1.2 0 2.3-.2 3.2-.6" /><ellipse cx="17" cy="15" rx="4" ry="2.5" /><path d="M13 15v4c0 1.4 1.8 2.5 4 2.5s4-1.1 4-2.5v-4" /></>,
    receipt: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" /><path d="M9 8h6M9 12h6M9 16h3" /></>,
    percent: <><path d="m19 5-14 14" /><circle cx="7" cy="7" r="2.5" /><circle cx="17" cy="17" r="2.5" /></>,
    cart: <><path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h8.8a2 2 0 0 0 1.9-1.4L22 9H6" /><circle cx="10" cy="20" r="1" /><circle cx="18" cy="20" r="1" /></>,
    shield: <><path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z" /><path d="m9 12 2 2 4-4" /></>,
    calculator: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M8 7h8M8 12h2m4 0h2m-8 4h2m4 0h2" /></>,
    credit: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18M7 15h3" /></>,
    check: <><circle cx="12" cy="12" r="9" /><path d="m8 12 2.5 2.5L16 9" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    wallet: <><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4H20v16H6a3 3 0 0 1-3-3V7a.5.5 0 0 1 1 0v10" /><path d="M20 9h-5a2 2 0 0 0 0 4h5" /><path d="M15 11h.01" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /><path d="m9 15 2 2 4-4" /></>,
  };
  return <svg {...shared} viewBox="0 0 24 24" aria-hidden="true">{drawings[name]}</svg>;
}

function Metric({ icon, kind, label, value, emphasis = false }: { icon: VatIconName; kind?: 'due' | 'credit' | 'paid' | 'outstanding' | 'reserve'; label: string; value: string; emphasis?: boolean }) {
  return <div className={`vat-metric ${kind ? `metric-${kind}` : ''} ${emphasis ? 'emphasis' : ''}`}><div className="vat-metric-label"><span className="vat-metric-icon"><VatIcon name={icon} /></span><span>{label}</span></div><strong>{value}</strong></div>;
}

function MetricRow({ title, tone, icon, metrics }: { title: string; tone: 'sales' | 'purchases' | 'settlement'; icon: VatIconName; ar: boolean; metrics: Array<{ icon: VatIconName; kind?: 'due' | 'credit' | 'paid' | 'outstanding' | 'reserve'; label: string; value: string; emphasis?: boolean }> }) {
  return <section className={`vat-metric-row ${tone}`}>
    <h3><span className="vat-row-icon"><VatIcon name={icon} /></span>{title}</h3>
    <div className="vat-metric-row-cards">{metrics.map((metric) => <Metric key={metric.label} {...metric} />)}</div>
  </section>;
}

function valuesFrom(row: VatPeriodSummaryRecord | null): VatPeriodSummaryInputs {
  const defaults = emptyVatPeriodSummary();
  if (!row) return defaults;
  return Object.fromEntries(VAT_SUMMARY_AMOUNT_FIELDS.map((field) => [field, text(row[field])]).concat([
    ['input_tax_recoverable_percent', text(row.input_tax_recoverable_percent)],
  ])) as VatPeriodSummaryInputs;
}

function daysBetween(from: string, to: string) {
  const [fromYear, fromMonth, fromDay] = from.split('-').map(Number);
  const [toYear, toMonth, toDay] = to.split('-').map(Number);
  return Math.ceil((Date.UTC(toYear, toMonth - 1, toDay) - Date.UTC(fromYear, fromMonth - 1, fromDay)) / 86400000);
}

function formatDate(date: string, ar: boolean) {
  return new Date(`${date}T12:00:00`).toLocaleDateString(ar ? 'ar-SA' : 'en-GB', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'Asia/Riyadh' });
}

function option(value: string, label: string) { return <option key={value} value={value}>{label}</option>; }

function messageFor(code: string, ar: boolean) {
  const labels: Record<string, [string, string]> = {
    UNAUTHORIZED: ['يلزم تسجيل الدخول.', 'Please sign in.'],
    ORGANIZATION_ACCESS_REQUIRED: ['ليس لديك صلاحية الوصول إلى هذه المؤسسة.', 'You do not have access to this organization.'],
    ORGANIZATION_ADMIN_REQUIRED: ['حفظ ملخص الفترة متاح لمالك المؤسسة أو مديرها.', 'Only an organization owner or admin can save period totals.'],
    VAT_PROFILE_REQUIRED: ['أكمل ملف التسجيل الضريبي أولًا.', 'Complete the VAT profile first.'],
    VAT_REGISTRATION_REQUIRED: ['يجب أن تكون المؤسسة مسجلة في ضريبة القيمة المضافة.', 'The organization must be VAT registered.'],
    VAT_SUMMARY_PERIOD_MISMATCH: ['تواريخ الملخص لا تطابق دورية الإقرار المسجلة.', 'The summary dates do not match the registered filing frequency.'],
  };
  return labels[code]?.[ar ? 0 : 1] ?? (ar ? 'تعذر حفظ الإجماليات. تحقق من البيانات وحاول مجددًا.' : 'Could not save totals. Check the values and retry.');
}
