"use client";

import {useEffect, useRef, useState} from "react";
import type {SupplierSchedule} from "@/lib/asset-financing-plan";
import AssetSupplierScheduleCard from "./AssetSupplierScheduleCard";

type Application = {
  payment_id: string;
  amount: string;
  date: string;
  kind: "DOWN_PAYMENT" | "INSTALLMENT";
  reversal_id: string | null;
  reversal_date: string | null;
};
type Schedule = Omit<SupplierSchedule, "applications"> & {
  payable_id: string;
  supplier_name: string;
  applications: Application[];
};
type Account = {id: string; name: string; currency: string};

function currentDate() {
  return new Intl.DateTimeFormat("en-CA", {timeZone: "Asia/Riyadh", dateStyle: "short"}).format(new Date());
}

export default function PersonalSupplierFunding({assetId, ar, revision, accounts, onChanged}: {
  assetId: string; ar: boolean; revision: number; accounts: Account[]; onChanged: () => void;
}) {
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [payment, setPayment] = useState<Application | null>(null);
  const inFlight = useRef(false);
  const lastPayment = useRef<{fingerprint: string; id: string} | null>(null);
  const t = (a: string, e: string) => ar ? a : e;

  useEffect(() => {
    const controller = new AbortController();
    setSchedule(null);
    setLoadError(false);
    fetch(`/api/assets/personal-supplier-schedule?asset_id=${encodeURIComponent(assetId)}`, {
      signal: controller.signal, cache: "no-store",
    }).then(async response => {
      if (!response.ok) throw Error("PERSONAL_SUPPLIER_SCHEDULE_FAILED");
      const data = await response.json();
      if (!data.schedule) throw Error("PERSONAL_SUPPLIER_SCHEDULE_FAILED");
      if (!controller.signal.aborted) setSchedule(data.schedule);
    }).catch(() => { if (!controller.signal.aborted) setLoadError(true); });
    return () => controller.abort();
  }, [assetId, revision, retry]);

  async function send(path: string, payload: object) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(path, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify(payload)});
      if (!response.ok) throw Error((await response.json()).error);
      lastPayment.current = null;
      setPayment(null);
      onChanged();
    } catch (e) {
      const code = e instanceof Error ? e.message : "";
      if (code === "PERSONAL_SUPPLIER_REVERSE_INSTALLMENTS_FIRST") {
        setError(t("اعكس سداد الأقساط أولًا، ثم اعكس الاقتناء.", "Reverse the installment payments first, then reverse the acquisition."));
      } else if (code === "PERSONAL_SUPPLIER_REVERSAL_HAS_ASSET_MOVEMENTS") {
        setError(t("توجد حركات لاحقة على الأصل تمنع عكس الاقتناء.", "Later asset movements prevent reversing the acquisition."));
      } else if (["CASH_INSUFFICIENT_BALANCE", "PERSONAL_CASH_INSUFFICIENT_BALANCE"].includes(code)) {
        setError(t("رصيد الحساب غير كافٍ لهذا السداد.", "The account balance is insufficient for this payment."));
      } else {
        setError(t("تعذر حفظ العملية. راجع حالة السند قبل إعادة المحاولة.", "Could not save this operation. Check the voucher status before retrying."));
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  if (loadError) return <section>
    <p role="alert">{t("تعذرت قراءة جدول المورد.", "Could not read the supplier schedule.")}</p>
    <button type="button" className="btn secondary" onClick={() => setRetry(n => n + 1)}>{t("إعادة المحاولة", "Retry")}</button>
  </section>;
  if (!schedule) return <p role="status">{t("جار تحميل جدول المورد…", "Loading the supplier schedule…")}</p>;

  const active = schedule.status === "ACTUAL";
  const outstanding = Number(schedule.remaining);
  const next = schedule.entries.find(entry => Number(entry.remaining) > 0);
  const eligibleAccounts = accounts.filter(account => account.currency === schedule.currency);
  const installments = schedule.applications.filter(row => row.kind === "INSTALLMENT" && !row.reversal_id);
  const card = {...schedule, applications: schedule.applications.map(row => ({
    allocation_id: row.payment_id,
    date: row.date, amount: row.amount, event_status: row.reversal_id ? "REVERSED" : "ACTUAL", reversal_date: row.reversal_date,
  }))};

  return <section aria-busy={busy} className="asset-entry-section-body">
    <p><strong>{t("المورد", "Supplier")}</strong> · {schedule.supplier_name}</p>
    <AssetSupplierScheduleCard schedule={card} ar={ar} personal/>
    {error && <p role="alert">{error}</p>}
    {active && outstanding > 0 && <form className="form-grid asset-funding-form" aria-label={t("سداد قسط", "Pay an installment")}
      onSubmit={event => {
        event.preventDefault();
        const fields = new FormData(event.currentTarget);
        const command = {
          action: "PAY", payable_id: schedule.payable_id, account_id: String(fields.get("account")),
          amount: Number(fields.get("amount")), date: String(fields.get("date")),
          notes: String(fields.get("notes")).trim(),
        };
        const fingerprint = JSON.stringify(command);
        if (lastPayment.current?.fingerprint !== fingerprint) lastPayment.current = {fingerprint, id: crypto.randomUUID()};
        void send("/api/personal-payables", {...command, request_id: lastPayment.current.id});
      }}>
      <label>{t("حساب السداد", "Payment account")}<select name="account" required defaultValue="">
        <option value="">{t("اختر الحساب", "Choose account")}</option>
        {eligibleAccounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
      </select></label>
      <label>{t("المبلغ", "Amount")}<input name="amount" type="number" required step="any" min="0.0001" max={outstanding}
        defaultValue={next?.remaining ?? schedule.remaining ?? ""}/></label>
      <label>{t("تاريخ السداد", "Payment date")}<input name="date" type="date" required max={currentDate()} defaultValue={currentDate()}/></label>
      <label>{t("البيان", "Description")}<input name="notes" required minLength={3} maxLength={500} defaultValue={t("سداد قسط المورد", "Supplier installment payment")}/></label>
      <button type="submit" className="btn" disabled={busy || !eligibleAccounts.length}>{t("تسجيل السداد", "Record payment")}</button>
    </form>}
    {active && installments.length > 0 && <ul className="asset-funding-applications">{installments.map(row => <li key={row.payment_id}>
      <bdi>{row.date} · {row.amount} {schedule.currency}</bdi>{" "}
      <button type="button" className="btn secondary" disabled={busy} onClick={() => setPayment(row)}>{t("عكس السداد", "Reverse payment")}</button>
    </li>)}</ul>}
    {active && payment && <form className="form-grid" onSubmit={event => {
      event.preventDefault();
      const reason = String(new FormData(event.currentTarget).get("reason")).trim();
      void send("/api/personal-payables", {action: "REVERSE_PAYMENT", payable_id: schedule.payable_id, payment_id: payment.payment_id, reason});
    }}>
      <label>{t("سبب العكس", "Reversal reason")}<input name="reason" required minLength={3} maxLength={500}/></label>
      <button type="submit" className="btn" disabled={busy}>{t("تأكيد عكس السداد", "Confirm payment reversal")}</button>
      <button type="button" className="btn secondary" disabled={busy} onClick={() => setPayment(null)}>{t("إلغاء", "Cancel")}</button>
    </form>}
    {active && !installments.length && !payment && <button type="button" className="btn secondary" disabled={busy} onClick={() => {
      if (window.confirm(t("عكس الاقتناء يعكس الالتزام ويعيد المقدم إلى حسابه عند وجوده. هل تؤكد العكس؟", "Reverse the acquisition and payable, and return any down payment to its account?"))) {
        void send("/api/assets/personal-supplier-schedule", {action: "REVERSE", asset_id: assetId});
      }
    }}>{t("عكس الاقتناء", "Reverse acquisition")}</button>}
  </section>;
}
