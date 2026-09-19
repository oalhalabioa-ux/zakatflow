"use client";
import { useEffect, useMemo, useState } from "react";
type SortKey = "date" | "asset" | "type" | "value" | "currency";
type SortDirection = "asc" | "desc";
const TRANSACTION_TYPES = [
  ["ADD", "إضافة"],
  ["OPENING_BALANCE", "رصيد افتتاحي"],
  ["PURCHASE", "شراء"],
  ["SALE", "بيع"],
  ["WITHDRAWAL", "سحب"],
  ["ADJUSTMENT", "تسوية"],
] as const;
const numberFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const integerFormatter = new Intl.NumberFormat("en-US");

function assetName(row: any) {
  return row.asset_accounts?.name || row.asset_account_id || "—";
}

function transactionTypeLabel(type: string) {
  return TRANSACTION_TYPES.find(([value]) => value === type)?.[1] || type;
}

export default function Transactions() {
  const [rows, setRows] = useState<any[]>([]);
  const [assets, setAssets] = useState<any[]>([]);
  const [sort, setSort] = useState<{
    key: SortKey;
    direction: SortDirection;
  }>({ key: "date", direction: "desc" });
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [form, setForm] = useState<any>({
    asset_account_id: "",
    transaction_type: "ADD",
    transaction_date: new Date().toISOString().slice(0, 10),
    quantity: 1,
    currency: "SAR",
    unit_price: "",
    gross_value: "",
    base_currency: "SAR",
    fx_rate: 1,
    base_value: "",
    notes: "",
  });
  const [msg, setMsg] = useState("");
  const load = async () => {
    setLoading(true);
    setLoadError("");
    try {
      const [transactionsResponse, assetsResponse] = await Promise.all([
        fetch("/api/transactions"),
        fetch("/api/assets"),
      ]);
      if (!transactionsResponse.ok || !assetsResponse.ok)
        throw new Error("LOAD_FAILED");
      const [transactions, assetRows] = await Promise.all([
        transactionsResponse.json(),
        assetsResponse.json(),
      ]);
      setRows(transactions);
      setAssets(assetRows);
      if (assetRows[0] && !form.asset_account_id)
        setForm((current: any) => ({
          ...current,
          asset_account_id: assetRows[0].id,
          currency: assetRows[0].currency,
          base_currency: assetRows[0].currency,
        }));
    } catch {
      setRows([]);
      setAssets([]);
      setLoadError("تعذر تحميل سجل المعاملات. حاول تحديث الصفحة.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  async function save() {
    setMsg("جار الحفظ…");
    const r = await fetch("/api/transactions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...form,
        quantity: Number(form.quantity),
        unit_price: form.unit_price === "" ? undefined : Number(form.unit_price),
        gross_value: Number(form.gross_value),
        base_value: Number(form.base_value),
      }),
    });
    setMsg(
      r.ok
        ? "تمت إضافة المعاملة وإنشاء Lot عند انطباق القاعدة."
        : (await r.json()).error || "خطأ",
    );
    if (r.ok) load();
  }
  const filteredRows = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("ar");
    return rows.filter((row) => {
      const matchesQuery =
        !normalizedQuery ||
        assetName(row).toLocaleLowerCase("ar").includes(normalizedQuery) ||
        String(row.transaction_type || "")
          .toLocaleLowerCase("ar")
          .includes(normalizedQuery) ||
        transactionTypeLabel(row.transaction_type)
          .toLocaleLowerCase("ar")
          .includes(normalizedQuery);
      const matchesType =
        !typeFilter || row.transaction_type === typeFilter;
      const date = String(row.transaction_date || "");
      const matchesFrom = !dateFrom || date >= dateFrom;
      const matchesTo = !dateTo || date <= dateTo;
      return matchesQuery && matchesType && matchesFrom && matchesTo;
    });
  }, [rows, query, typeFilter, dateFrom, dateTo]);
  const sortedRows = useMemo(() => {
    const valueOf = (row: any) => {
      if (sort.key === "date") return String(row.transaction_date || "");
      if (sort.key === "asset") return String(assetName(row));
      if (sort.key === "type") return String(row.transaction_type || "");
      if (sort.key === "currency") return String(row.base_currency || "");
      return Number(row.base_value) || 0;
    };
    return [...filteredRows].sort((a, b) => {
      const left = valueOf(a);
      const right = valueOf(b);
      const compared =
        typeof left === "number" && typeof right === "number"
          ? left - right
          : String(left).localeCompare(String(right), "ar", {
              numeric: true,
              sensitivity: "base",
            });
      return sort.direction === "asc" ? compared : -compared;
    });
  }, [filteredRows, sort]);
  const summary = useMemo(
    () => {
      const inflowTypes = new Set(["ADD", "OPENING_BALANCE", "PURCHASE", "TRANSFER_IN"]);
      const outflowTypes = new Set(["SALE", "WITHDRAWAL", "TRANSFER_OUT", "ZAKAT_PAYMENT"]);
      const inflows = rows.reduce((sum, row) => sum + (inflowTypes.has(row.transaction_type) ? Number(row.base_value) || 0 : 0), 0);
      const outflows = rows.reduce((sum, row) => sum + (outflowTypes.has(row.transaction_type) ? Number(row.base_value) || 0 : 0), 0);
      return ({
      count: rows.length,
      total: rows.reduce((sum, row) => sum + (Number(row.base_value) || 0), 0),
      inflows,
      outflows,
      net: inflows - outflows,
      assets: new Set(rows.map((row) => row.asset_account_id).filter(Boolean))
        .size,
      latest:
        rows
          .map((row) => String(row.transaction_date || ""))
          .filter(Boolean)
          .sort()
          .at(-1) || "—",
    });
    },
    [rows],
  );
  const hasFilters = Boolean(query || typeFilter || dateFrom || dateTo);
  const displayMetric = (value: string) =>
    loading ? "…" : loadError ? "—" : value;
  const changeSort = (key: SortKey) => {
    setSort((current) => ({
      key,
      direction:
        current.key === key && current.direction === "asc" ? "desc" : "asc",
    }));
  };
  const sortMark = (key: SortKey) =>
    sort.key === key ? (sort.direction === "asc" ? "↑" : "↓") : "↕";
  return (
    <main className="container transactions-page">
      <div className="page-head transaction-page-head">
        <div>
          <span className="pill">TRANSACTION LEDGER</span>
          <h1>
            <span className="page-title-icon" aria-hidden="true">
              ⇄
            </span>{" "}
            سجل المعاملات
          </h1>
          <p className="muted">
            كل حركة تدخل في الحساب تبدأ من هذا السجل، ويحفظ التصحيح عن طريق
            Reversal دون حذف التاريخ.
          </p>
        </div>
      </div>
      {loadError && <div className="notice">{loadError}</div>}
      <section className="transaction-kpis section">
        <TransactionKpi
          icon="▤"
          label="عدد المعاملات"
          value={displayMetric(integerFormatter.format(summary.count))}
        />
        <TransactionKpi
          icon="◆"
          label="صافي الحركة"
          value={displayMetric(`${numberFormatter.format(summary.net)} SAR`)}
        />
        <TransactionKpi
          icon="▦"
          label="الأصول المتحركة"
          value={displayMetric(integerFormatter.format(summary.assets))}
        />
        <TransactionKpi
          icon="◷"
          label="آخر حركة"
          value={displayMetric(summary.latest)}
        />
      </section>
      <div className="card section transaction-entry-card">
        <div className="transaction-section-head">
          <div>
            <span className="transaction-ledger-kicker">إدخال حركة جديدة</span>
            <h2>إضافة معاملة</h2>
          </div>
          <span className="pill">تُحفظ في السجل</span>
        </div>
        <div className="form-grid">
          <Field label="الأصل">
            <select
              value={form.asset_account_id}
              onChange={(e) =>
                setForm({ ...form, asset_account_id: e.target.value })
              }
            >
              {assets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} — {a.asset_type}
                </option>
              ))}
            </select>
          </Field>
          <Field label="النوع">
            <select
              value={form.transaction_type}
              onChange={(e) =>
                setForm({ ...form, transaction_type: e.target.value })
              }
            >
              {TRANSACTION_TYPES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label} — {value}
                </option>
              ))}
            </select>
          </Field>
          <Field label="التاريخ">
            <input
              type="date"
              value={form.transaction_date}
              onChange={(e) =>
                setForm({ ...form, transaction_date: e.target.value })
              }
            />
          </Field>
          <Field label="الكمية">
            <input
              type="number"
              step="any"
              value={form.quantity}
              onChange={(e) => { const quantity = e.target.value; const grossValue = (Number(quantity) || 0) * (Number(form.unit_price) || 0); setForm({ ...form, quantity, gross_value: grossValue || "", base_value: grossValue ? grossValue * (Number(form.fx_rate) || 1) : "" }); }}
            />
          </Field>
          <Field label="سعر الوحدة">
            <input
              type="number"
              min="0"
              step="any"
              value={form.unit_price}
              onChange={(e) => {
                const unitPrice = e.target.value;
                const grossValue = (Number(form.quantity) || 0) * (Number(unitPrice) || 0);
                setForm({ ...form, unit_price: unitPrice, gross_value: grossValue || "", base_value: grossValue ? grossValue * (Number(form.fx_rate) || 1) : "" });
              }}
            />
          </Field>
          <Field label="إجمالي القيمة">
            <input type="number" step="any" value={form.gross_value} readOnly />
          </Field>
          <Field label="عملة المعاملة">
            <input value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} />
          </Field>
          <Field label="العملة الأساسية">
            <input value={form.base_currency} onChange={(e) => setForm({ ...form, base_currency: e.target.value.toUpperCase() })} />
          </Field>
          <Field label="سعر الصرف">
            <input
              type="number"
              min="0"
              step="any"
              value={form.fx_rate}
              onChange={(e) => {
                const fxRate = e.target.value;
                setForm({ ...form, fx_rate: fxRate, base_value: (Number(form.gross_value) || 0) * (Number(fxRate) || 0) });
              }}
            />
          </Field>
          <Field label="القيمة بالعملة الأساسية">
            <input type="number" step="any" value={form.base_value} readOnly />
          </Field>
        </div>
        <button
          className="btn"
          onClick={save}
          disabled={!form.asset_account_id}
        >
          إضافة
        </button>
        {msg && <p className="muted">{msg}</p>}
      </div>
      <div className="card section transaction-ledger-card">
        <div className="transaction-ledger-head">
          <div>
            <span className="transaction-ledger-kicker">سجل الحركة</span>
            <h2>المعاملات المسجلة</h2>
          </div>
          <span className="transaction-ledger-count">
            {integerFormatter.format(filteredRows.length)} من {integerFormatter.format(rows.length)}
          </span>
        </div>
        <div className="transaction-filters">
          <label>
            <span>بحث</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="اسم الأصل أو نوع المعاملة"
            />
          </label>
          <label>
            <span>نوع المعاملة</span>
            <select
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value)}
            >
              <option value="">جميع الأنواع</option>
              {TRANSACTION_TYPES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>من تاريخ</span>
            <input
              type="date"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
            />
          </label>
          <label>
            <span>إلى تاريخ</span>
            <input
              type="date"
              value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
            />
          </label>
          {hasFilters && (
            <button
              type="button"
              className="btn secondary transaction-clear-filters"
              onClick={() => {
                setQuery("");
                setTypeFilter("");
                setDateFrom("");
                setDateTo("");
              }}
            >
              مسح الفلاتر
            </button>
          )}
        </div>
        <div className="transaction-table-wrap">
          <table className="table">
            <thead>
              <tr>
                <SortableHeader label="التاريخ" column="date" sort={sort} onSort={changeSort} mark={sortMark("date")} />
                <SortableHeader label="الأصل" column="asset" sort={sort} onSort={changeSort} mark={sortMark("asset")} />
                <SortableHeader label="النوع" column="type" sort={sort} onSort={changeSort} mark={sortMark("type")} />
                <SortableHeader label="القيمة" column="value" sort={sort} onSort={changeSort} mark={sortMark("value")} />
                <SortableHeader label="العملة" column="currency" sort={sort} onSort={changeSort} mark={sortMark("currency")} />
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((r) => (
                <tr key={r.id}>
                  <td>{r.transaction_date}</td>
                  <td><strong>{assetName(r)}</strong></td>
                  <td><span className="pill transaction-type-pill">{transactionTypeLabel(r.transaction_type)}</span></td>
                  <td className="transaction-value">
                    {numberFormatter.format(Number(r.base_value) || 0)}
                  </td>
                  <td>{r.base_currency}</td>
                </tr>
              ))}
              {!loading && sortedRows.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    {hasFilters
                      ? "لا توجد معاملات مطابقة للفلاتر الحالية."
                      : "لا توجد معاملات بعد."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}

function TransactionKpi({
  icon,
  label,
  value,
}: {
  icon: string;
  label: string;
  value: string;
}) {
  return (
    <div className="card transaction-kpi">
      <div className="transaction-kpi-head">
        <span aria-hidden="true">{icon}</span>
        <small className="muted">{label}</small>
      </div>
      <strong>{value}</strong>
    </div>
  );
}

function SortableHeader({
  label,
  column,
  sort,
  onSort,
  mark,
}: {
  label: string;
  column: SortKey;
  sort: { key: SortKey; direction: SortDirection };
  onSort: (key: SortKey) => void;
  mark: string;
}) {
  const active = sort.key === column;
  return (
    <th aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        className={`transaction-sort${active ? " active" : ""}`}
        onClick={() => onSort(column)}
      >
        <span>{label}</span>
        <span aria-hidden="true">{mark}</span>
      </button>
    </th>
  );
}
function Field({
  label,
  children,
}: {
  label: string;
  children?: React.ReactNode;
}) {
  return (
    <label>
      {label}
      {children}
    </label>
  );
}
