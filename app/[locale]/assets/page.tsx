"use client";
import { use, useEffect, useMemo, useState } from "react";
import {
  ASSET_COLUMNS,
  type AssetColumn,
  type AssetSortColumn,
  type AssetSortDirection,
  type AssetTablePreferences,
  assetCostValue,
  assetCurrentValue,
  assetHawlDate,
  assetTablePreset,
  parseAssetTablePreferences,
  sortAssetRows,
  visibleAssetColumns,
} from "@/lib/asset-table-preferences";
type T =
  | "CASH"
  | "BANK"
  | "GOLD"
  | "SILVER"
  | "STOCK"
  | "INVENTORY"
  | "RECEIVABLE"
  | "REAL_ESTATE"
  | "OTHER";
const TYPES: Array<[T, string, string, string]> = [
  ["CASH", "نقد", "Cash", "¤"],
  ["BANK", "حساب بنكي", "Bank", "▥"],
  ["GOLD", "ذهب", "Gold", "◆"],
  ["SILVER", "فضة", "Silver", "◇"],
  ["STOCK", "أسهم", "Stocks", "↗"],
  ["INVENTORY", "مخزون", "Inventory", "▦"],
  ["RECEIVABLE", "ذمم مدينة", "Receivable", "≡"],
  ["REAL_ESTATE", "عقار", "Real estate", "⌂"],
  ["OTHER", "أصل آخر", "Other", "•"],
];
type AssetsPageDesign = "executive" | "cards" | "analytical";
const FX = 3.75,
  empty: any = {
    asset_type: "CASH",
    name: "",
    amount: "",
    quantity: "",
    purchase_price: "",
    market_price: "",
    karat: "24",
    purpose: "",
    purchase_date: "",
    is_zakatable: true,
  };
const fmt = (n: any) =>
  new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(n) || 0);
const daysFrom = (s?: string) =>
  s
    ? Math.max(
        0,
        Math.floor(
          (Date.now() - new Date(`${s}T00:00:00`).getTime()) / 86400000,
        ),
      )
    : 0;
const hawlParts = (s?: string) => {
  if (!s) return null;
  const d = daysFrom(s);
  return { cycles: Math.floor(d / 354), extra: d % 354 };
};
export default function Assets({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = use(params),
    ar = locale === "ar";
  const [rows, setRows] = useState<any[]>([]),
    [form, setForm] = useState<any>(empty),
    [edit, setEdit] = useState<string | null>(null),
    [saving, setSaving] = useState(false),
    [msg, setMsg] = useState(""),
    [loadError, setLoadError] = useState(""),
    [loading, setLoading] = useState(true),
    [usd, setUsd] = useState(false),
    [closed, setClosed] = useState<Record<string, boolean>>({}),
    [tablePreferences, setTablePreferences] =
      useState<AssetTablePreferences>(() => assetTablePreset("professional")),
    [design, setDesign] = useState<AssetsPageDesign>("executive"),
    [sort, setSort] = useState<{
      column: AssetSortColumn;
      direction: AssetSortDirection;
    }>({ column: "current", direction: "desc" });
  const cur = usd ? "USD" : "SAR",
    cv = (n: any) => (usd ? Number(n || 0) / FX : Number(n || 0));
  const load = async () => {
    setLoading(true);
    setLoadError("");
    try {
      const response = await fetch("/api/assets");
      if (!response.ok) throw new Error("LOAD_FAILED");
      setRows(await response.json());
    } catch {
      setRows([]);
      setLoadError(
        ar ? "تعذر تحميل الأصول. حاول تحديث الصفحة." : "Could not load assets. Refresh the page to try again.",
      );
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
    try {
      const storedPreferences =
        localStorage.getItem("zf_asset_table_v4") ||
        localStorage.getItem("zf_asset_table_v3") ||
        localStorage.getItem("zf_asset_table_v2");
      setTablePreferences(parseAssetTablePreferences(storedPreferences));
      const savedDesign =
        localStorage.getItem("zf_assets_design_v2") ||
        localStorage.getItem("zf_assets_design");
      if (["executive", "cards", "analytical"].includes(savedDesign || ""))
        setDesign(savedDesign as AssetsPageDesign);
    } catch {}
    const onSettings = (event: Event) => {
      const detail = (event as CustomEvent<AssetTablePreferences>).detail;
      setTablePreferences(parseAssetTablePreferences(JSON.stringify(detail)));
    };
    const onDesign = (event: Event) => {
      const next = (event as CustomEvent<{ design: AssetsPageDesign }>).detail
        ?.design;
      if (next && ["executive", "cards", "analytical"].includes(next))
        setDesign(next);
    };
    window.addEventListener("zf-asset-table-settings", onSettings);
    window.addEventListener("zf-assets-page-design", onDesign);
    return () => {
      window.removeEventListener("zf-asset-table-settings", onSettings);
      window.removeEventListener("zf-assets-page-design", onDesign);
    };
  }, []);
  const orderedColumns = useMemo(
    () => visibleAssetColumns(tablePreferences.order, tablePreferences.visible),
    [tablePreferences.order, tablePreferences.visible],
  );
  const m = (r: any, k: string) => Number(r?.metadata?.[k] || 0),
    val = assetCurrentValue,
    costVal = assetCostValue;
  const calc = (r: any) => r.zakat_calculation || null,
    due = (r: any) => Number(calc(r)?.zakat_amount || 0),
    paid = (r: any) => Number(calc(r)?.paid_amount || 0),
    remaining = (r: any) => Math.max(0, due(r) - paid(r));
  const hawlStart = (r: any) =>
    calc(r)
      ?.lots?.map((x: any) => x.hawl_start_date)
      .filter(Boolean)
      .sort()?.[0];
  const lotHawlStart = (r: any) =>
    r?.lots
      ?.map((x: any) => x.hawl_start_date)
      .filter(Boolean)
      .sort()?.[0];
  const hawlDisplayDate = (r: any) => assetHawlDate(r) || undefined;
  const metal = form.asset_type === "GOLD" || form.asset_type === "SILVER",
    market = metal || form.asset_type === "STOCK",
    qty = market || form.asset_type === "INVENTORY";
  const pc = qty
      ? (+form.quantity || 0) * (+form.purchase_price || 0)
      : +form.amount || 0,
    mv = market ? (+form.quantity || 0) * (+form.market_price || 0) : pc;
  const groups = useMemo(
    () =>
      TYPES.map(([type]) => ({
        type,
        rows: rows.filter((r) => r.asset_type === type),
      })).filter((g) => g.rows.length),
    [rows],
  );
  const total = rows.reduce((s, r) => s + val(r), 0),
    cost = rows.reduce((s, r) => s + costVal(r), 0),
    totalDue = rows.reduce((s, r) => s + due(r), 0),
    totalPaid = rows.reduce((s, r) => s + paid(r), 0),
    z = rows.filter((r) => r.is_zakatable),
    completed = z.filter((r) => (calc(r)?.statuses || []).includes("ELIGIBLE")),
    near = z.filter((r) => {
      const d = calc(r)
        ?.lots?.map((x: any) => x.hawl_due_date)
        .filter(Boolean)
        .sort()?.[0];
      if (!d) return false;
      const n = Math.ceil(
        (new Date(`${d}T00:00:00`).getTime() - Date.now()) / 86400000,
      );
      return n >= 0 && n <= 30;
    });
  const info = (t: string) => TYPES.find((x) => x[0] === t),
    label = (t: string) => info(t)?.[ar ? 1 : 2] || t,
    icon = (t: string) => info(t)?.[3] || "💼";
  const retroPending = rows.filter(
    (r) =>
      r.is_zakatable &&
      (calc(r)?.statuses || []).includes("NOT_ASSESSED") &&
      (calc(r)?.lots || []).some((l: any) => l.hawl_start_date),
  );
  const editRow = (r: any) => {
    const d = r.metadata || {};
    setEdit(r.id);
    setForm({
      asset_type: r.asset_type,
      name: r.name,
      amount: d.opening_value ?? "",
      quantity: d.quantity ?? "",
      purchase_price: d.purchase_price ?? "",
      market_price: d.market_price ?? "",
      karat: d.karat ?? 24,
      purpose: d.purpose ?? "",
      purchase_date: d.purchase_date ?? "",
      is_zakatable: r.is_zakatable,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const columnLabel = (column: AssetColumn) => {
    const definition = ASSET_COLUMNS.find(([key]) => key === column)!;
    return ar ? definition[1] : definition[2];
  };
  const changeSort = (column: AssetSortColumn) => {
    setSort((current) => ({
      column,
      direction:
        current.column === column && current.direction === "asc"
          ? "desc"
          : "asc",
    }));
  };
  const sortMark = (column: AssetSortColumn) =>
    sort.column === column ? (sort.direction === "asc" ? "↑" : "↓") : "↕";
  const renderAssetCell = (column: AssetColumn, row: any) => {
    switch (column) {
      case "asset":
        return (
          <strong className="asset-name-cell">
            <span className="asset-row-icon" aria-hidden="true">
              {icon(row.asset_type)}
            </span>
            {row.name}
          </strong>
        );
      case "date":
        return row.metadata?.purchase_date || "—";
      case "weight":
        return ["GOLD", "SILVER"].includes(row.asset_type)
          ? `${fmt(m(row, "quantity"))} g`
          : m(row, "quantity")
            ? fmt(m(row, "quantity"))
            : "—";
      case "hawl":
        return (
          <HawlBadge
            date={hawlDisplayDate(row)}
            ar={ar}
            displayOnly={
              !hawlStart(row) &&
              !lotHawlStart(row) &&
              Boolean(
                calc(row)?.hawl_display_only?.portfolio_nisab_reached_date,
              )
            }
          />
        );
      case "cost":
        return `${fmt(cv(costVal(row)))} ${cur}`;
      case "current":
        return <strong>{fmt(cv(val(row)))} {cur}</strong>;
      case "due":
        return `${fmt(cv(due(row)))} ${cur}`;
      case "paid":
        return `${fmt(cv(paid(row)))} ${cur}`;
      case "remaining":
        return `${fmt(cv(remaining(row)))} ${cur}`;
      case "calculation":
        return (
          <ZakatCell
            row={row}
            ar={ar}
            amount={`${fmt(cv(due(row)))} ${cur}`}
          />
        );
      case "action":
        return (
          <button
            type="button"
            className="btn secondary asset-edit-btn"
            onClick={() => editRow(row)}
            aria-label={ar ? `تعديل ${row.name}` : `Edit ${row.name}`}
          >
            ✎
          </button>
        );
    }
  };
  const save = async () => {
    if (!form.name || !form.purchase_date) {
      setMsg(ar ? "أدخل الاسم وتاريخ الشراء" : "Enter name and purchase date");
      return;
    }
    setSaving(true);
    const metadata: any = {
      purchase_value: pc,
      market_value: mv,
      estimated_value: mv,
      purchase_date: form.purchase_date,
    };
    if (form.amount) metadata.opening_value = +form.amount;
    if (form.quantity) metadata.quantity = +form.quantity;
    if (form.purchase_price) metadata.purchase_price = +form.purchase_price;
    if (form.market_price) metadata.market_price = +form.market_price;
    if (metal) metadata.karat = +form.karat;
    if (form.purpose) metadata.purpose = form.purpose;
    const body = {
      ...(edit ? { id: edit } : {}),
      asset_type: form.asset_type,
      name: form.name,
      currency: "SAR",
      unit: metal ? "g" : form.asset_type === "STOCK" ? "share" : "unit",
      is_zakatable: form.is_zakatable,
      metadata,
    };
    const r = await fetch("/api/assets", {
      method: edit ? "PUT" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (r.ok) {
      setForm({ ...empty });
      setEdit(null);
      setMsg(
        ar
          ? "تم الحفظ — أنشئ Snapshot جديد لتحديث الاحتساب الزكوي"
          : "Saved — create a new Snapshot to refresh Zakat calculation",
      );
      await load();
    } else {
      const result = await r.json().catch(() => ({}));
      setMsg(result.error || (ar ? "تعذر الحفظ" : "Save failed"));
    }
    setSaving(false);
  };
  return (
    <main className={`container assets-page assets-page-${design}`}>
      <style>{`.asset-report-table[data-size=compact] th,.asset-report-table[data-size=compact] td{padding:7px 8px;font-size:11px}.asset-report-table[data-size=normal] th,.asset-report-table[data-size=normal] td{padding:12px;font-size:13px}.asset-report-table[data-size=wide] th,.asset-report-table[data-size=wide] td{padding:17px 20px;font-size:14px}.asset-report-table th{min-width:105px;white-space:nowrap}.asset-report-table th[data-column=asset]{min-width:180px}.hawl-badges{display:inline-flex;gap:5px;white-space:nowrap}.hawl-cycle,.hawl-days{display:inline-flex;align-items:center;gap:4px;padding:4px 8px;border-radius:8px}.hawl-cycle{background:#dcfce7;color:#166534}.hawl-days{background:#fce7f3;color:#9d174d}.zakat-formula{margin-top:10px;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:#fafcfb;color:var(--ink);min-width:280px}.zakat-formula-title{font-weight:700;margin-bottom:5px}.zakat-formula-eq{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;direction:ltr;text-align:left;white-space:normal;line-height:1.7}.zakat-formula-result{font-weight:800;margin-top:5px}`}</style>
      <div className="page-head">
        <div>
          <h1>
            <span className="page-title-icon" aria-hidden="true">
              ▥
            </span>{" "}
            {ar ? "الأصول" : "Assets"}
          </h1>
          <p className="muted">
            {ar
              ? "الزكاة والحول أدناه من آخر Snapshot لمحرك الاحتساب، وليست من القيم القديمة المخزنة في الأصل."
              : "Zakat and Hawl below come from the latest engine Snapshot, not legacy asset metadata."}
          </p>
        </div>
        <div>
          <button
            className={`btn ${usd ? "secondary" : ""}`}
            onClick={() => setUsd(false)}
          >
            🇸🇦 SAR
          </button>{" "}
          <button
            className={`btn ${!usd ? "secondary" : ""}`}
            onClick={() => setUsd(true)}
          >
            🇺🇸 USD
          </button>
        </div>
      </div>
      {loadError && <div className="notice">{loadError}</div>}
      {retroPending.length > 0 && (
        <div className="notice">
          <strong>
            {ar ? "أصول تحتاج إعادة احتساب" : "Assets awaiting recalculation"}
          </strong>
          <div className="muted">
            {ar
              ? `${retroPending.length} أصل/أصول لها حول محفوظ لكنها غير موجودة في آخر Snapshot. إعادة احتساب الدورة الحالية ستضمها دون تعديل Snapshot مغلق.`
              : `${retroPending.length} asset(s) have persisted Hawl data but are missing from the latest Snapshot. Recalculating the current cycle will include them without changing closed snapshots.`}
          </div>
        </div>
      )}
      <section className="grid section">
        <K
          i="◆"
          tone="value"
          t={ar ? "القيمة الحالية" : "Current value"}
          v={`${fmt(cv(total))} ${cur}`}
          source={ar ? "سجل التقييم" : "Valuation ledger"}
        />
        <K
          i="▤"
          tone="cost"
          t={ar ? "تكلفة الشراء" : "Purchase cost"}
          v={`${fmt(cv(cost))} ${cur}`}
          source={ar ? "سجل الأصول" : "Asset ledger"}
        />
        <K
          i="↗"
          tone="gain"
          t={ar ? "الربح / الخسارة" : "Gain / loss"}
          v={`${fmt(cv(total - cost))} ${cur}`}
          source={ar ? "محسوب مباشرة" : "Live calculation"}
        />
        <K
          i="◉"
          tone="due"
          t={ar ? "الزكاة المحتسبة" : "Calculated Zakat"}
          v={`${fmt(cv(totalDue))} ${cur}`}
          source={ar ? "آخر Snapshot" : "Latest Snapshot"}
        />
        <K
          i="✓"
          tone="paid"
          t={ar ? "المدفوع المخصص" : "Allocated paid"}
          v={`${fmt(cv(totalPaid))} ${cur}`}
          source={ar ? "تخصيصات السداد" : "Payment allocations"}
        />
        <K
          i="▦"
          tone="count"
          t={ar ? "عدد الأصول" : "Assets"}
          v={`${rows.length}`}
          source={ar ? "السجل الفعلي" : "Live ledger"}
        />
        <K
          i="◷"
          tone="hawl"
          t={ar ? "مؤهل بالحول" : "Hawl eligible"}
          v={`${completed.length}`}
          source={ar ? "آخر Snapshot" : "Latest Snapshot"}
        />
        <K
          i="!"
          tone="due"
          t={ar ? "استحقاق خلال 30 يوماً" : "Due within 30 days"}
          v={`${near.length}`}
          source={ar ? "تواريخ الحول" : "Hawl dates"}
        />
      </section>
      <section className="card section">
        <h3>
          {edit ? "✏️ " : "＋ "}
          {edit
            ? ar
              ? "تعديل الأصل"
              : "Edit asset"
            : ar
              ? "إضافة أصل"
              : "Add asset"}
        </h3>
        <div className="form-grid">
          <label>
            {ar ? "نوع الأصل" : "Type"}
            <select
              value={form.asset_type}
              onChange={(e) =>
                setForm({
                  ...form,
                  asset_type: e.target.value,
                  karat: e.target.value === "SILVER" ? "999" : "24",
                })
              }
            >
              {TYPES.map(([v, a, e, i]) => (
                <option key={v} value={v}>
                  {i} {ar ? a : e}
                </option>
              ))}
            </select>
          </label>
          <label>
            {ar ? "اسم الأصل" : "Name"}
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
          <label>
            {ar ? "تاريخ الشراء / التملك" : "Purchase date"}
            <input
              type="date"
              value={form.purchase_date}
              onChange={(e) =>
                setForm({ ...form, purchase_date: e.target.value })
              }
            />
          </label>
          {qty ? (
            <>
              <label>
                {metal
                  ? ar
                    ? "الوزن بالغرام"
                    : "Weight g"
                  : ar
                    ? "الكمية"
                    : "Quantity"}
                <input
                  type="number"
                  step="0.001"
                  value={form.quantity}
                  onChange={(e) =>
                    setForm({ ...form, quantity: e.target.value })
                  }
                />
              </label>
              <label>
                {ar ? "سعر الشراء" : "Purchase price"}
                <input
                  type="number"
                  step="0.01"
                  value={form.purchase_price}
                  onChange={(e) =>
                    setForm({ ...form, purchase_price: e.target.value })
                  }
                />
              </label>
              {market && (
                <label>
                  {ar ? "سعر السوق" : "Market price"}
                  <input
                    type="number"
                    step="0.01"
                    value={form.market_price}
                    onChange={(e) =>
                      setForm({ ...form, market_price: e.target.value })
                    }
                  />
                </label>
              )}
              {metal && (
                <label>
                  {ar ? "العيار / النقاوة" : "Karat / purity"}
                  <input
                    type="number"
                    step="0.001"
                    value={form.karat}
                    onChange={(e) =>
                      setForm({ ...form, karat: e.target.value })
                    }
                  />
                </label>
              )}
            </>
          ) : (
            <label>
              {ar ? "القيمة / الرصيد" : "Value / balance"}
              <input
                type="number"
                step="0.01"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
              />
            </label>
          )}
          <label>
            {ar ? "زكوي؟" : "Zakatable?"}
            <select
              value={form.is_zakatable ? "1" : "0"}
              onChange={(e) =>
                setForm({ ...form, is_zakatable: e.target.value === "1" })
              }
            >
              <option value="1">✓ {ar ? "نعم" : "Yes"}</option>
              <option value="0">— {ar ? "لا" : "No"}</option>
            </select>
          </label>
        </div>
        <button type="button" className="btn" onClick={save} disabled={saving}>
          {saving
            ? "…"
            : edit
              ? "✓ " + (ar ? "حفظ التعديلات" : "Save changes")
              : "＋ " + (ar ? "حفظ الأصل" : "Save asset")}
        </button>
        {edit && (
          <button
            className="btn secondary"
            type="button"
            onClick={() => {
              setEdit(null);
              setForm({ ...empty });
            }}
          >
            {ar ? "إلغاء" : "Cancel"}
          </button>
        )}
        {msg && <p className="muted">{msg}</p>}
      </section>
      <section className="section">
        <h2>
          <span className="section-title-icon" aria-hidden="true">
            ▤
          </span>{" "}
          {ar ? "تقرير الأصول" : "Asset report"}
        </h2>
        {loading && <div className="card section muted">{ar ? "جارٍ تحميل الأصول…" : "Loading assets…"}</div>}
        {!loading && !loadError && groups.length === 0 && (
          <div className="card section muted">
            {ar ? "لا توجد أصول بعد. أضف الأصل الأول من النموذج أعلاه." : "No assets yet. Add the first asset using the form above."}
          </div>
        )}
        {groups.map((g) => {
          const sub = g.rows.reduce((s, r) => s + val(r), 0),
            sd = g.rows.reduce((s, r) => s + due(r), 0),
            isClosed = !!closed[g.type],
            sortedRows = sortAssetRows(g.rows, sort.column, sort.direction);
          return (
            <div className="card section asset-group" key={g.type}>
              <div className="page-head asset-group-head">
                <div>
                  <h3 className="asset-type-title">
                    <span className="asset-type-icon">{icon(g.type)}</span>
                    {label(g.type)}{" "}
                    <span className="pill">{g.rows.length}</span>
                  </h3>
                  <div className="asset-summary">
                    <span className="sum-chip">
                      <span className="sum-icon" aria-hidden="true">
                        ◆
                      </span>
                      <span>{ar ? "إجمالي القيمة" : "Total value"}</span>
                      <strong>
                        {fmt(cv(sub))} {cur}
                      </strong>
                    </span>
                    <span className="sum-chip due">
                      <span className="sum-icon" aria-hidden="true">
                        ◉
                      </span>
                      <span>{ar ? "زكاة Snapshot" : "Snapshot Zakat"}</span>
                      <strong>
                        {fmt(cv(sd))} {cur}
                      </strong>
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  className="btn secondary collapse-btn"
                  onClick={() =>
                    setClosed((x) => ({ ...x, [g.type]: !x[g.type] }))
                  }
                >
                  {isClosed ? "＋" : "−"}
                </button>
              </div>
              {!isClosed && (
                <div style={{ overflowX: "auto" }}>
                  <table
                    className="table asset-report-table"
                    data-size={tablePreferences.size}
                    data-preset={tablePreferences.preset}
                  >
                    <thead>
                      <tr>
                        {orderedColumns.map((column) => {
                          const sortable = column !== "action";
                          const active = sortable && sort.column === column;
                          return (
                            <th
                              key={column}
                              data-column={column}
                              aria-sort={
                                active
                                  ? sort.direction === "asc"
                                    ? "ascending"
                                    : "descending"
                                  : undefined
                              }
                            >
                              {sortable ? (
                                <button
                                  type="button"
                                  className={`asset-sort${active ? " active" : ""}`}
                                  onClick={() =>
                                    changeSort(column as AssetSortColumn)
                                  }
                                >
                                  <span>{columnLabel(column)}</span>
                                  <span aria-hidden="true">
                                    {sortMark(column as AssetSortColumn)}
                                  </span>
                                </button>
                              ) : (
                                columnLabel(column)
                              )}
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {sortedRows.map((row) => (
                        <tr key={row.id}>
                          {orderedColumns.map((column) => (
                            <td key={column} data-column={column}>
                              {renderAssetCell(column, row)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </section>
    </main>
  );
}
function HawlBadge({
  date,
  ar,
  displayOnly = false,
}: {
  date?: string;
  ar: boolean;
  displayOnly?: boolean;
}) {
  const h = hawlParts(date);
  if (!h) return <span className="pill">{ar ? "لم يبدأ" : "Not started"}</span>;
  return (
    <span
      className={`hawl-badges${displayOnly ? " display-only" : ""}`}
      title={
        displayOnly
          ? ar
            ? "مدة مرجعية للمحفظة فقط — لم تُثبت كبداية حول لهذا الأصل"
            : "Portfolio reference only — not persisted as this asset Hawl start"
          : undefined
      }
    >
      <span className="hawl-cycle">
        <b>{h.cycles}</b> {ar ? "حول" : "Hawl"}
      </span>
      <span className="hawl-days">
        <b>{h.extra}</b> {ar ? "يوم" : "days"}
      </span>
      {displayOnly && (
        <span className="hawl-reference">{ar ? "مرجعي" : "Reference"}</span>
      )}
    </span>
  );
}
function ZakatCell({
  row,
  ar,
  amount,
}: {
  row: any;
  ar: boolean;
  amount: string;
}) {
  const c = row.zakat_calculation;
  if (!row.is_zakatable)
    return <span className="pill">{ar ? "غير زكوي" : "Exempt"}</span>;
  if (!c)
    return <span className="pill">{ar ? "غير محتسب" : "Not assessed"}</span>;
  if (c.statuses?.includes("NOT_ASSESSED")) {
    const hasPersistedHawl = (c.lots || []).some((l: any) => l.hawl_start_date);
    return (
      <span className="pill">
        {hasPersistedHawl
          ? ar
            ? "بانتظار إعادة الاحتساب"
            : "Awaiting recalculation"
          : ar
            ? "غير محتسب"
            : "Not assessed"}
      </span>
    );
  }
  const s = c.statuses || [];
  const label = s.includes("ELIGIBLE")
    ? ar
      ? "مؤهل"
      : "Eligible"
    : s.includes("HAWL_NOT_COMPLETED")
      ? ar
        ? "لم يكتمل الحول"
        : "Hawl pending"
      : s.includes("BELOW_NISAB")
        ? ar
          ? "أقل من النصاب"
          : "Below Nisab"
        : ar
          ? "غير مؤهل"
          : "Not eligible";
  return (
    <div className="zakat-result-compact">
      <strong>{amount}</strong> <span className="pill">{label}</span>
    </div>
  );
}
function K({
  t,
  v,
  i,
  tone,
  source,
}: {
  t: string;
  v: string;
  i: string;
  tone: string;
  source: string;
}) {
  return (
    <div className={`card asset-kpi tone-${tone}`}>
      <div className="asset-kpi-head">
        <span className="kpi-icon" aria-hidden="true">
          {i}
        </span>
        <span className="muted">{t}</span>
      </div>
      <div className="metric">{v}</div>
      <div className="asset-kpi-source">
        <span aria-hidden="true" />
        {source}
      </div>
      <span className="asset-kpi-accent" aria-hidden="true" />
    </div>
  );
}
