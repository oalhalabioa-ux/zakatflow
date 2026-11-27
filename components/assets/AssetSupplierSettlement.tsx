import Decimal from "decimal.js";

type Props = {
  ar: boolean;
  posted: boolean;
  flow: { amount: string | number; settled_amount: string | number | null; currency: string; due_date: string } | null;
  cost: string | number | null;
  baseCurrency: string;
  marketValue?: { amount: number; currency: string };
};

export default function AssetSupplierSettlement({ ar, posted, flow, cost, baseCurrency, marketValue }: Props) {
  const t = (arabic: string, english: string) => ar ? arabic : english;
  const money = (value: Decimal.Value, currency: string) => new Intl.NumberFormat(ar ? "ar-SA" : "en", {
    style: "currency", currency,
  }).format(Number(value));
  const amount = new Decimal(flow?.amount ?? 0);
  const paid = new Decimal(flow?.settled_amount ?? 0);
  const remaining = Decimal.max(0, amount.minus(paid));
  const percent = amount.gt(0) ? Decimal.min(100, paid.div(amount).times(100)).toDecimalPlaces(2).toNumber() : 0;
  const applicable = posted && Boolean(flow);
  return <div className="asset-funding-settlement">
    <dl className="asset-funding-amounts">
      <div><dt>{t("تكلفة الاقتناء", "Acquisition cost")}</dt>
        <dd>{posted && cost !== null ? money(cost, baseCurrency) : "—"}</dd></div>
      <div><dt>{t("القيمة السوقية", "Market value")}</dt>
        <dd>{marketValue ? money(marketValue.amount, marketValue.currency) : "—"}</dd></div>
      <div><dt>{t("إجمالي المسدد", "Total paid")}</dt>
        <dd>{applicable && flow ? money(paid, flow.currency) : "—"}</dd></div>
      <div><dt>{t("الالتزام المتبقي", "Outstanding liability")}</dt>
        <dd>{applicable && flow ? money(remaining, flow.currency) : "—"}</dd></div>
      <div><dt>{t("الدفعة التالية", "Next payment")}</dt>
        <dd>{applicable && flow && remaining.gt(0)
          ? <><bdi>{flow.due_date}</bdi> · <bdi>{money(remaining, flow.currency)}</bdi></> : "—"}</dd></div>
    </dl>
    {applicable && flow ? <>
      <label className="asset-funding-progress">
        {t("نسبة السداد", "Percentage paid")} · {percent}%
        <progress value={percent} max={100} />
      </label>
      <div className="asset-funding-table" tabIndex={0} role="region" aria-label={t("استحقاق المورد", "Supplier obligation")}>
        <table>
          <thead><tr>
            <th scope="col">{t("الاستحقاق", "Due date")}</th>
            <th scope="col">{t("الإجمالي", "Total")}</th>
            <th scope="col">{t("المسدد", "Paid")}</th>
            <th scope="col">{t("المتبقي", "Outstanding")}</th>
            <th scope="col">{t("الحالة", "Status")}</th>
          </tr></thead>
          <tbody><tr>
            <td><bdi>{flow.due_date}</bdi></td>
            <td><bdi>{money(amount, flow.currency)}</bdi></td>
            <td><bdi>{money(paid, flow.currency)}</bdi></td>
            <td><bdi>{money(remaining, flow.currency)}</bdi></td>
            <td>{remaining.isZero() ? t("مسدد", "Paid") : paid.gt(0)
              ? t("مسدد جزئيًا", "Partially paid") : t("مستحق", "Outstanding")}</td>
          </tr></tbody>
        </table>
      </div>
    </> : <p className="asset-entry-hint">
      {posted ? t("لا يوجد استحقاق مورد مرتبط.", "No supplier obligation is linked.")
        : t("تظهر الأرصدة المعتمدة بعد ترحيل سند الشراء.", "Posted balances appear after the purchase voucher is posted.")}
    </p>}
  </div>;
}
