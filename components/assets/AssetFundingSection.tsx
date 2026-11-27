"use client";

import { useId, useState, type ReactNode } from "react";
import Decimal from "decimal.js";
import { ActionIconGlyph } from "../ActionButton";
import { RoyalIcon } from "../feasibility/RoyalIcon";
import {
  assetMoneyDigits,
  generateAssetInstallments,
  maxAssetInstallments,
  supplierScheduleTerms,
  validateAssetInstallments,
  type AssetFundingMode,
  type InstallmentDraft,
  type InstallmentFrequency,
  type SupplierScheduleTerms,
} from "@/lib/asset-financing-plan";

const methods = [
  ["CASH", "شراء نقدي", "Cash purchase"],
  ["DEFERRED", "شراء آجل", "Deferred purchase"],
  ["INSTALLMENTS", "شراء بالتقسيط", "Installment purchase"],
  ["EXTERNAL", "تمويل بنكي أو خارجي", "Bank or external financing"],
  ["MIXED", "تمويل مختلط", "Mixed financing"],
] as const;

const frequencies = [
  ["MONTHLY", "شهري", "Monthly"],
  ["QUARTERLY", "ربع سنوي", "Quarterly"],
  ["SEMIANNUAL", "نصف سنوي", "Semiannual"],
  ["ANNUAL", "سنوي", "Annual"],
  ["CUSTOM", "مخصص", "Custom"],
] as const;

const validationMessages: Record<string, [string, string]> = {
  ASSET_FINANCING_AMOUNT_INVALID: ["أدخل مبالغ غير سالبة.", "Enter nonnegative amounts."],
  ASSET_FINANCING_AMOUNT_PRECISION: ["أدخل المبالغ بدقة العملة المحددة.", "Use the selected currency’s precision."],
  ASSET_FINANCING_DOWN_PAYMENT_INVALID: ["تأكد من إجمالي الفاتورة وأن المقدم أقل منه.", "Check the invoice total and enter a smaller down payment."],
  ASSET_FINANCING_DATE_INVALID: ["أكمل الاستحقاقات بالترتيب، بدءًا من تاريخ الشراء أو بعده.", "Enter due dates in order, on or after the purchase date."],
  ASSET_FINANCING_COUNT_INVALID: ["تحقق من عدد الدفعات وإمكان توزيع أصل الالتزام.", "Check the number of payments and whether the principal can be distributed."],
  ASSET_FINANCING_SUPPLIER_PRINCIPAL_ONLY: ["يدعم جدول المورد أصل الذمة. تكلفة التمويل لها مسار مستقل.", "The supplier schedule covers principal. Financing costs require a separate workflow."],
  ASSET_FINANCING_SCHEDULE_TOTAL: ["طابق مجموع أصل الدفعات وتكلفة التمويل مع الإجماليات.", "Match the scheduled principal and financing cost to their totals."],
};

type Props = {
  ar: boolean;
  mode: AssetFundingMode;
  onModeChange: (mode: AssetFundingMode) => void;
  scope: "PERSONAL" | "ORGANIZATION";
  currency: string;
  purchaseDate: string;
  invoiceNet: number;
  invoiceTax: number;
  invoiceTotal: number;
  existingCashFields?: ReactNode;
  canSave: boolean;
  restricted: boolean;
  supplierSchedule?: boolean;
  downPaymentAccounts?: {id: string; name: string}[];
};

function FundingGlyph({ mode }: { mode: AssetFundingMode }) {
  if (mode === "EXTERNAL") return <ActionIconGlyph name="bank" />;
  if (mode === "MIXED") return <RoyalIcon name="wallet" />;
  if (mode === "DEFERRED") return <ActionIconGlyph name="month" />;
  if (mode === "INSTALLMENTS") return <ActionIconGlyph name="quarter" />;
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
    <rect x="3" y="6" width="18" height="12" rx="2" />
    <circle cx="12" cy="12" r="2.5" />
    <path d="M6 12h1m10 0h1" />
  </svg>;
}

export default function AssetFundingSection(props: Props) {
  const { ar, mode, onModeChange, scope, currency, purchaseDate, invoiceNet, invoiceTax, invoiceTotal, existingCashFields, canSave, restricted, supplierSchedule, downPaymentAccounts = [] } = props;
  const personalSchedule = scope === "PERSONAL" && supplierSchedule && (mode === "DEFERRED" || mode === "INSTALLMENTS");
  const [downPayment, setDownPayment] = useState("0");
  const [financeCost, setFinanceCost] = useState("0");
  const [count, setCount] = useState("10");
  const [firstDue, setFirstDue] = useState("");
  const [frequency, setFrequency] = useState<InstallmentFrequency>("MONTHLY");
  const [rows, setRows] = useState<InstallmentDraft[]>([]);
  const [generationError, setGenerationError] = useState("");
  const group = useId();
  const t = (arabic: string, english: string) => ar ? arabic : english;
  const digits = assetMoneyDigits(currency);
  const smallestUnit = new Decimal(10).pow(-digits).toString();
  const money = new Intl.NumberFormat(ar ? "ar-SA" : "en", {
    style: "currency", currency,
  });
  const showMoney = (value: number | string) => money.format(Number(value));
  const installmentInput = {
    currency, purchaseDate, downPayment, financeCost, invoiceTotal: String(invoiceTotal),
  };
  let preview: ReturnType<typeof validateAssetInstallments> | undefined;
  let terms: SupplierScheduleTerms | undefined;
  let validationError = "";
  if (rows.length) {
    try {
      preview = validateAssetInstallments(installmentInput, rows);
      if (supplierSchedule) terms = supplierScheduleTerms("INSTALLMENTS", installmentInput, rows);
    }
    catch (error) { validationError = (error as Error).message; }
  }
  const errorText = (code: string) =>
    (validationMessages[code] ?? validationMessages.ASSET_FINANCING_AMOUNT_INVALID)[ar ? 0 : 1];
  const changeTerms = (change: () => void) => {
    change(); setRows([]); setGenerationError("");
  };
  const generate = () => {
    try {
      if (supplierSchedule && Number(count) < 2) throw Error("ASSET_FINANCING_COUNT_INVALID");
      setRows(generateAssetInstallments(installmentInput, Number(count), frequency, firstDue));
      setGenerationError("");
    } catch (error) {
      setRows([]);
      setGenerationError((error as Error).message);
    }
  };
  const editRow = (index: number, field: keyof InstallmentDraft, value: string) =>
    setRows(current => current.map((row, i) => i === index ? { ...row, [field]: value } : row));

  return <details className="asset-entry-group asset-funding-section" open>
    <summary>
      <span className="asset-funding-heading-icon"><ActionIconGlyph name="pay" /></span>
      {t("طريقة التمويل والسداد", "Funding & settlement")}
      <span className="asset-entry-chevron" aria-hidden="true">⌄</span>
    </summary>
    <div className="asset-entry-section-body">
      <fieldset className="asset-funding-methods">
        <legend>{t("طريقة الشراء", "Payment method")}</legend>
        {methods.map(([key, label, english]) => <label className="asset-funding-method" key={key}>
          <input type="radio" name={group} value={key} checked={mode === key}
            disabled={restricted && key !== "CASH" && !(scope === "ORGANIZATION" && key === "DEFERRED")}
            onChange={() => onModeChange(key)} />
          <span><FundingGlyph mode={key} />{t(label, english)}</span>
        </label>)}
      </fieldset>
      {restricted && <p className="asset-entry-hint">
        {t("طرق التمويل الجديدة لهذا التصنيف تحتاج اعتماد الأهلية.", "New financing methods for this classification require an eligibility decision.")}
      </p>}
      {!canSave && <p className="asset-funding-notice" role="status">
        {t("معاينة فقط. حفظ هذه الطريقة يتطلب ربطها بسند التمويل والسداد.", "Preview only. Saving this method requires the financing and settlement connection.")}
      </p>}
      {scope === "ORGANIZATION" && mode === "DEFERRED" && <p className="asset-entry-hint">
        {t("تُحفظ فاتورة المورد للمراجعة. يُسجّل السداد من سند الشراء بعد الاعتماد والترحيل.", "The supplier invoice is saved for review. Record payment from the purchase voucher after approval and posting.")}
      </p>}
      {scope === "PERSONAL" && mode === "CASH" && existingCashFields}
      {personalSchedule && <div className="form-grid asset-funding-form">
        <label>{t("اسم المورد", "Supplier name")}<input name="personal_supplier_name" required maxLength={120}/></label>
        {mode === "INSTALLMENTS" && Number(downPayment) > 0 && <label>{t("حساب سداد المقدم", "Down-payment account")}
          <select name="personal_supplier_down_account" required defaultValue="">
            <option value="">{t("اختر الحساب", "Choose account")}</option>
            {downPaymentAccounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
          </select>
        </label>}
      </div>}
      {(mode === "DEFERRED" || mode === "INSTALLMENTS") && <>
        <dl className="asset-funding-amounts">
          <div><dt>{t("صافي الفاتورة", "Net invoice")}</dt><dd>{showMoney(invoiceNet)}</dd></div>
          <div><dt>{t("الضريبة", "VAT")}</dt><dd>{showMoney(invoiceTax)}</dd></div>
          <div><dt>{t("الإجمالي", "Invoice total")}</dt><dd>{showMoney(invoiceTotal)}</dd></div>
        </dl>
        {mode === "DEFERRED" && <p className="asset-entry-hint">
          {t("لا دفعة فورية. إجمالي الفاتورة هو المبلغ المستحق للمورد.", "No payment now. The invoice total is due to the supplier.")}
        </p>}
      </>}
      {mode === "INSTALLMENTS" && <>
        {terms && <input type="hidden" name="supplier_schedule" value={JSON.stringify(terms)}/>}
        {supplierSchedule && <p className="asset-entry-hint">{personalSchedule ? t("يُخصم المقدم عند حفظ الاقتناء، وتُسجّل الأقساط اللاحقة من بطاقة الأصل.", "The down payment is posted on save. Record later installments from the asset card.") : t("يُحفظ أصل الذمة وجدولها مع مسودة الشراء. يسجَّل المقدم والسداد الفعلي بعد الترحيل من حساب السداد.", "The supplier principal schedule saves with the draft. Record the down payment and other actual payments after posting.")}</p>}
        <div className="form-grid asset-funding-form">
          <label>{scope === "ORGANIZATION" ? t("المقدم المخطط", "Planned down payment") : t("الدفعة الأولى", "Down payment")}
            <input type="number" min="0" step={smallestUnit} value={downPayment}
              onChange={e => changeTerms(() => setDownPayment(e.target.value))} />
          </label>
          {!supplierSchedule && <label>{t("تكلفة التمويل الإضافية", "Separate financing cost")}
            <input type="number" min="0" step={smallestUnit} value={financeCost}
              onChange={e => changeTerms(() => setFinanceCost(e.target.value))} />
          </label>}
          <label>{t("عدد الدفعات", "Number of payments")}
            <input type="number" min={supplierSchedule ? 2 : 1} max={maxAssetInstallments} step="1" value={count}
              onChange={e => changeTerms(() => setCount(e.target.value))} />
          </label>
          <label>{t("الدورية", "Frequency")}
            <select value={frequency} onChange={e => changeTerms(() => setFrequency(e.target.value as InstallmentFrequency))}>
              {frequencies.map(([value, name, english]) => <option value={value} key={value}>{t(name, english)}</option>)}
            </select>
          </label>
          <label>{t("أول استحقاق", "First due date")}
            <input type="date" min={purchaseDate} value={firstDue}
              onChange={e => changeTerms(() => setFirstDue(e.target.value))} />
          </label>
        </div>
        <button type="button" className="btn secondary asset-funding-generate" onClick={generate}>
          {t("إنشاء جدول الدفعات", "Generate payment schedule")}
        </button>
        {generationError && <p className="asset-funding-notice" role="alert">{errorText(generationError)}</p>}
        {rows.length > 0 && <>
          {validationError && <p className="asset-funding-notice" role="alert">{errorText(validationError)}</p>}
          {preview && !validationError && <div aria-live="polite" className="asset-funding-preview">
            <dl className="asset-funding-amounts">
              <div><dt>{scope === "ORGANIZATION" ? t("المقدم المخطط", "Planned down payment") : t("المدفوع الآن", "Paid now")}</dt><dd>{showMoney(preview.payableNow)}</dd></div>
              <div><dt>{t("أصل الالتزام المتبقي", "Remaining principal")}</dt><dd>{showMoney(preview.remainingPrincipal)}</dd></div>
              <div><dt>{t("إجمالي الدفعات المستقبلية", "Future payments")}</dt><dd>{showMoney(preview.futureTotal)}</dd></div>
            </dl>
            <label className="asset-funding-progress">
              {personalSchedule ? t("نسبة المقدم", "Down payment percentage") : t("نسبة المقدم المخطط", "Planned down payment percentage")} · {preview.paidPercent}%
              <progress value={preview.paidPercent} max={100} />
            </label>
          </div>}
          <div className="asset-funding-table" tabIndex={0} role="region" aria-label={t("جدول الدفعات", "Payment schedule")}>
            <table>
              <thead><tr>{[
                t("القسط", "Payment"), t("الاستحقاق", "Due date"), t("الأصل", "Principal"),
                t("التمويل", "Financing cost"), t("الإجمالي", "Total"), t("المسدد", "Paid"),
                t("المتبقي", "Outstanding"), t("الحالة", "Status"),
              ].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead>
              <tbody>{rows.map((row, i) => {
                const total = row.principal !== "" && Number.isFinite(Number(row.principal)) && Number.isFinite(Number(row.financeCost))
                  ? showMoney(new Decimal(row.principal).plus(row.financeCost || "0").toString()) : "—";
                const number = i + 1;
                return <tr key={i}>
                  <th scope="row">{number}</th>
                  <td><input aria-label={t("استحقاق القسط ", "Due date for payment ") + number} type="date"
                    min={purchaseDate} value={row.dueDate} onChange={e => editRow(i, "dueDate", e.target.value)} /></td>
                  <td><input aria-label={t("أصل القسط ", "Principal for payment ") + number} type="number"
                    min="0" step={smallestUnit} value={row.principal} onChange={e => editRow(i, "principal", e.target.value)} /></td>
                  <td><input aria-label={t("تمويل القسط ", "Financing cost for payment ") + number} type="number"
                    min="0" step={smallestUnit} value={row.financeCost} readOnly={supplierSchedule} onChange={e => editRow(i, "financeCost", e.target.value)} /></td>
                  <td><bdi>{total}</bdi></td>
                  <td><bdi>{showMoney(0)}</bdi></td>
                  <td><bdi>{total}</bdi></td>
                  <td>{t("مسودة", "Draft")}</td>
                </tr>;
              })}</tbody>
            </table>
          </div>
        </>}
      </>}
    </div>
  </details>;
}
