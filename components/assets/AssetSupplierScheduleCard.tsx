'use client';

import Decimal from "decimal.js";
import type {SupplierSchedule} from "@/lib/asset-financing-plan";
import {assetPurchaseStatus} from "@/lib/asset-purchase-workspace";

export default function AssetSupplierScheduleCard({schedule, ar, marketValue, personal = false}: {
  schedule: SupplierSchedule;
  ar: boolean;
  personal?: boolean;
  marketValue?: {amount: number; currency: string};
}) {
  const t = (a: string, e: string) => ar ? a : e;
  const money = (amount: string | number | null, currency = schedule.currency) => amount == null ? "—" :
    <bdi>{new Intl.NumberFormat(ar ? "ar-SA" : "en", {style: "currency", currency}).format(Number(amount))}</bdi>;
  const next = schedule.entries.find(row => row.remaining != null && new Decimal(row.remaining).gt(0));
  const percent = schedule.applied == null ? null : new Decimal(schedule.applied).div(schedule.document_total).mul(100).toDecimalPlaces(2).toNumber();
  return <section className="asset-funding-settlement" aria-label={t("جدول المورد المحفوظ", "Saved supplier schedule")}>
    <h4>{t("جدول المورد المحفوظ", "Saved supplier schedule")}</h4>
    <dl className="asset-funding-amounts">
      <div><dt>{t("تكلفة الاقتناء", "Acquisition cost")}</dt><dd>{money(schedule.asset_cost)}</dd></div>
      <div><dt>{t("القيمة السوقية", "Market value")}</dt><dd>{marketValue ? money(marketValue.amount, marketValue.currency) : "—"}</dd></div>
      <div><dt>{t("إجمالي الفاتورة", "Invoice total")}</dt><dd>{money(schedule.document_total)}</dd></div>
      <div><dt>{t("إجمالي المسدد", "Total paid")}</dt><dd>{money(schedule.applied)}</dd></div>
      <div><dt>{t("الالتزام المتبقي", "Outstanding liability")}</dt><dd>{money(schedule.remaining)}</dd></div>
      <div><dt>{t("الدفعة التالية", "Next payment")}</dt><dd>{next ? <><bdi>{next.due_date}</bdi> · {money(next.remaining)}</> : "—"}</dd></div>
    </dl>
    {percent != null && <label className="asset-funding-progress">
      {t("نسبة السداد", "Percentage paid")} · {percent}%<progress value={percent} max={100}/>
    </label>}
    {schedule.status === "REVIEW_REQUIRED" && <p role="alert">{t("تحتاج الذمة إلى مطابقة قبل عرض المسدد والمتبقي.", "Reconcile the liability before using paid and outstanding amounts.")}</p>}
    {schedule.status === "REVERSED" && <p role="status">{t("عُكس الاقتناء.", "Acquisition reversed.")}</p>}
    {schedule.status !== "ACTUAL" && schedule.status !== "REVIEW_REQUIRED" && schedule.status !== "REVERSED" && <p className="asset-entry-hint">
      {t("المبالغ في الجدول مخططة. يظهر المسدد بعد ترحيل الشراء وتطبيق السداد.", "The schedule shows planned amounts. Actual payments appear after posting the purchase and applying settlement.")}
    </p>}
    <div className="asset-funding-table" tabIndex={0} role="region" aria-label={t("دفعات المورد", "Supplier installments")}>
      <table><thead><tr>{[
        t("الدفعة", "Payment"), t("الاستحقاق", "Due date"), t("أصل الذمة", "Principal"),
        t("المسدد", "Paid"), t("المتبقي", "Outstanding"), t("الحالة", "Status"),
      ].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead>
        <tbody>{schedule.entries.map(entry => <tr key={entry.id}>
          <th scope="row">{entry.kind === "DOWN_PAYMENT" ? (personal ? t("المقدم", "Down payment") : t("مقدم مخطط", "Planned down payment")) : entry.position}</th>
          <td><bdi>{entry.due_date}</bdi></td><td>{money(entry.principal)}</td>
          <td>{money(entry.applied)}</td><td>{money(entry.remaining)}</td>
          <td>{entry.remaining == null ? (schedule.status === "REVIEW_REQUIRED" ? t("بحاجة إلى مطابقة", "Review required") : assetPurchaseStatus(schedule.status,ar))
            : new Decimal(entry.remaining).isZero() ? t("مسدد", "Paid")
              : new Decimal(entry.applied ?? "0").gt(0) ? t("مسدد جزئيًا", "Partially paid") : t("مستحق", "Outstanding")}</td>
        </tr>)}</tbody>
      </table>
    </div>
    {schedule.applications.length > 0 && <details>
      <summary>{t("تطبيقات السداد والعكس", "Settlement and reversal records")}</summary>
      <ul>{schedule.applications.map(item => <li key={item.allocation_id}><bdi>{item.date}</bdi> · {money(item.amount)} · {
        item.event_status === "REVERSED" ? <>{t("معكوس", "Reversed")} {item.reversal_date && <bdi>{item.reversal_date}</bdi>}</> : t("مرحّل", "Posted")
      }</li>)}</ul>
    </details>}
  </section>;
}
