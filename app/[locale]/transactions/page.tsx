"use client";
import { useEffect, useMemo, useState } from "react";
type Design = "executive" | "timeline" | "cashflow";
type SortKey = "date" | "asset" | "type" | "value" | "currency";
type SortDirection = "asc" | "desc";
const numberFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function assetName(row: any) {
  return row.asset_accounts?.name || row.asset_account_id || "—";
}

export default function Transactions() {
  const [rows, setRows] = useState<any[]>([]);
  const [assets, setAssets] = useState<any[]>([]);
  const [design, setDesign] = useState<Design>("executive");
  const [sort, setSort] = useState<{
    key: SortKey;
    direction: SortDirection;
  }>({ key: "date", direction: "desc" });
  const [form, setForm] = useState<any>({
    asset_account_id: "",
    transaction_type: "ADD",
    transaction_date: new Date().toISOString().slice(0, 10),
    quantity: 1,
    currency: "SAR",
    gross_value: "",
    base_currency: "SAR",
    base_value: "",
    notes: "",
  });
  const [msg, setMsg] = useState("");
  const load = () => {
    fetch("/api/transactions")
      .then((r) => (r.ok ? r.json() : []))
      .then(setRows);
    fetch("/api/assets")
      .then((r) => (r.ok ? r.json() : []))
      .then((a) => {
        setAssets(a);
        if (a[0] && !form.asset_account_id)
          setForm((x: any) => ({
            ...x,
            asset_account_id: a[0].id,
            currency: a[0].currency,
            base_currency: a[0].currency,
          }));
      });
  };
  useEffect(() => {
    load();
    const d = localStorage.getItem("zf_transactions_design");
    if (d === "executive" || d === "timeline" || d === "cashflow") setDesign(d);
  }, []);
  async function save() {
    setMsg("جار الحفظ…");
    const r = await fetch("/api/transactions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...form,
        quantity: Number(form.quantity),
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
  const choose = (v: Design) => {
    setDesign(v);
    localStorage.setItem("zf_transactions_design", v);
  };
  const sortedRows = useMemo(() => {
    const valueOf = (row: any) => {
      if (sort.key === "date") return String(row.transaction_date || "");
      if (sort.key === "asset") return String(assetName(row));
      if (sort.key === "type") return String(row.transaction_type || "");
      if (sort.key === "currency") return String(row.base_currency || "");
      return Number(row.base_value) || 0;
    };
    return [...rows].sort((a, b) => {
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
  }, [rows, sort]);
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
    <main
      className={`container transactions-page transaction-design-${design}`}
    >
      <div className="transaction-design-picker">
        <span>تصميم الصفحة</span>
        {(
          [
            ["executive", "1 تنفيذي"],
            ["timeline", "2 خط زمني"],
            ["cashflow", "3 تدفقات"],
          ] as const
        ).map(([v, l]) => (
          <button
            key={v}
            className={design === v ? "active" : ""}
            onClick={() => choose(v)}
          >
            {l}
          </button>
        ))}
      </div>
      <h1>سجل المعاملات</h1>
      <p className="muted">
        كل عملية تدخل في الحساب تبدأ من هذا السجل. لا نحذف التاريخ؛ نستخدم
        Reversal.
      </p>
      <div className="card section transaction-entry-card">
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
              {[
                "ADD",
                "OPENING_BALANCE",
                "PURCHASE",
                "SALE",
                "WITHDRAWAL",
                "ADJUSTMENT",
              ].map((x) => (
                <option key={x}>{x}</option>
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
              onChange={(e) => setForm({ ...form, quantity: e.target.value })}
            />
          </Field>
          <Field label="القيمة">
            <input
              type="number"
              step="any"
              value={form.gross_value}
              onChange={(e) =>
                setForm({
                  ...form,
                  quantity: e.target.value,
                  gross_value: e.target.value,
                  base_value: e.target.value,
                })
              }
            />
          </Field>
          <Field label="العملة">
            <input
              value={form.currency}
              onChange={(e) =>
                setForm({
                  ...form,
                  currency: e.target.value,
                  base_currency: e.target.value,
                })
              }
            />
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
            {numberFormatter.format(rows.length).replace(".00", "")} معاملة
          </span>
        </div>
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
                <td>{assetName(r)}</td>
                <td>{r.transaction_type}</td>
                <td className="transaction-value">
                  {numberFormatter.format(Number(r.base_value) || 0)}
                </td>
                <td>{r.base_currency}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  لا توجد معاملات بعد.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
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
