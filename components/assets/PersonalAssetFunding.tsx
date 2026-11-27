"use client";

import { useEffect, useState } from "react";

type Payment = {
  id: string; date: string; reference: string | null;
  amount: number; currency: string; acquisitionCost: number; baseCurrency: string;
  reversedOn: string | null;
};

export default function PersonalAssetFunding({ assetId, ar, revision }: {
  assetId: string; ar: boolean; revision: number;
}) {
  const [state, setState] = useState<{ payment: Payment | null; error: boolean }>();
  const t = (arabic: string, english: string) => ar ? arabic : english;
  useEffect(() => {
    const controller = new AbortController();
    setState(undefined);
    fetch(`/api/assets/${encodeURIComponent(assetId)}/funding`, { signal: controller.signal, cache: "no-store" })
      .then(async response => {
        if (!response.ok) throw Error("ASSET_FUNDING_READ_FAILED");
        const { payment } = await response.json();
        if (!controller.signal.aborted) setState({ payment, error: false });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ payment: null, error: true });
      });
    return () => controller.abort();
  }, [assetId, revision]);
  if (!state) return <p role="status">{t("جار تحميل سند التمويل…", "Loading the funding voucher…")}</p>;
  if (state.error) return <p role="alert">{t("تعذرت قراءة سجل التمويل.", "Could not read the funding record.")}</p>;
  const payment = state.payment;
  if (!payment) return <p>{t("لا يوجد سند دفع نقدي مثبت لهذا الاقتناء.", "No verified cash payment is linked to this acquisition.")}</p>;
  const money = (amount: number, currency: string) =>
    new Intl.NumberFormat(ar ? "ar-SA" : "en", { style: "currency", currency }).format(amount);
  return <section className="asset-funding-settlement" aria-label={t("التمويل والسداد", "Funding & settlement")}>
    <dl className="asset-funding-amounts">
      <div><dt>{t("تكلفة الاقتناء المسجلة", "Recorded acquisition cost")}</dt>
        <dd>{money(payment.acquisitionCost, payment.baseCurrency)}</dd></div>
      <div><dt>{t("إجمالي المسدد", "Total paid")}</dt>
        <dd>{money(payment.reversedOn ? 0 : payment.amount, payment.currency)}</dd></div>
      <div><dt>{t("طريقة الشراء", "Payment method")}</dt><dd>{t("شراء نقدي", "Cash purchase")}</dd></div>
    </dl>
    <div className="asset-funding-table" tabIndex={0} role="region" aria-label={t("حركة الدفع", "Payment movement")}>
      <table>
        <thead><tr>
          <th scope="col">{t("التاريخ", "Date")}</th>
          <th scope="col">{t("المرجع", "Reference")}</th>
          <th scope="col">{t("المبلغ", "Amount")}</th>
          <th scope="col">{t("الحالة", "Status")}</th>
        </tr></thead>
        <tbody><tr>
          <td><bdi>{payment.date}</bdi></td>
          <td><bdi>{payment.reference || payment.id}</bdi></td>
          <td><bdi>{money(payment.amount, payment.currency)}</bdi></td>
          <td>{payment.reversedOn
            ? <>{t("معكوس", "Reversed")} · <bdi>{payment.reversedOn}</bdi></>
            : t("مسدد", "Paid")}</td>
        </tr></tbody>
      </table>
    </div>
  </section>;
}
