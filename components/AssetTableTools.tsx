"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
export const ASSET_COLS = [
  ["asset", "الأصل", "Asset"],
  ["date", "تاريخ الشراء", "Purchase date"],
  ["weight", "الوزن", "Weight"],
  ["hawl", "الحول", "Hawl"],
  ["cost", "التكلفة", "Cost"],
  ["current", "القيمة الحالية", "Current value"],
  ["due", "الزكاة المستحقة", "Zakat due"],
  ["paid", "المدفوعة", "Paid"],
  ["remaining", "المتبقي", "Remaining"],
  ["calculation", "الاحتساب الزكوي", "Zakat calculation"],
  ["action", "الإجراء", "Action"],
] as const;
export type AssetColumn = (typeof ASSET_COLS)[number][0];
type Size = "compact" | "normal" | "wide";
type Design = "executive" | "cards" | "analytical";
const orderDefault = ASSET_COLS.map((c) => c[0]) as AssetColumn[];
const defaults = () =>
  Object.fromEntries(ASSET_COLS.map((c) => [c[0], true])) as Record<
    string,
    boolean
  >;
function enhanceAssetRows(ar: boolean) {
  document
    .querySelectorAll<HTMLTableElement>(".asset-report-table")
    .forEach((table) => {
      table
        .querySelectorAll("tbody tr:not(.asset-detail-row)")
        .forEach((row) => {
          if (row.querySelector(".asset-row-details")) return;
          const cells = [...row.children] as HTMLElement[];
          const action = cells[cells.length - 1];
          if (!action) return;
          const b = document.createElement("button");
          b.type = "button";
          b.className = "asset-row-details";
          b.setAttribute(
            "aria-label",
            ar
              ? "عرض تفاصيل العملية والاحتساب"
              : "Show operation and calculation details",
          );
          b.textContent = "⌄";
          action.prepend(b);
          const detail = document.createElement("tr");
          detail.className = "asset-detail-row";
          const td = document.createElement("td");
          td.colSpan = cells.length;
          const box = document.createElement("details");
          box.className = "asset-detail";
          const summary = document.createElement("summary");
          summary.textContent = ar
            ? "تفاصيل العملية والاحتساب والدورة"
            : "Operation, calculation and cycle details";
          const grid = document.createElement("div");
          grid.className = "asset-detail-grid";
          const labels = ar
            ? ["الأصل", "تاريخ الشراء", "الحول", "الزكاة"]
            : ["Asset", "Purchase date", "Hawl", "Zakat"];
          [0, 1, 3, 6].forEach((i, n) => {
            const x = document.createElement("div");
            const s = document.createElement("span");
            s.textContent = labels[n];
            const strong = document.createElement("strong");
            strong.textContent = cells[i]?.textContent?.trim() || "—";
            x.append(s, strong);
            grid.append(x);
          });
          box.append(summary, grid);
          td.append(box);
          detail.append(td);
          row.after(detail);
          b.onclick = () => {
            box.open = !box.open;
          };
        });
    });
}
export default function AssetTableTools({ ar }: { ar: boolean }) {
  const active = usePathname()?.includes("/assets");
  const [open, setOpen] = useState(false),
    [size, setSize] = useState<Size>("normal"),
    [design, setDesign] = useState<Design>("executive"),
    [visible, setVisible] = useState(defaults),
    [order, setOrder] = useState(orderDefault),
    [assets, setAssets] = useState<any[]>([]),
    [selected, setSelected] = useState(""),
    [msg, setMsg] = useState(""),
    [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!active) return;
    try {
      const p = JSON.parse(
        localStorage.getItem("zf_asset_table_v3") ||
          localStorage.getItem("zf_asset_table_v2") ||
          "{}",
      );
      if (p.size) setSize(p.size);
      if (["executive", "cards", "analytical"].includes(p.design))
        setDesign(p.design);
      if (p.visible) setVisible({ ...defaults(), ...p.visible });
      if (p.order)
        setOrder(
          p.order.concat(orderDefault.filter((x) => !p.order.includes(x))),
        );
    } catch {}
  }, [active]);
  if (!active) return null;
  const emit = (x: any) =>
    window.dispatchEvent(
      new CustomEvent("zf-asset-table-settings", {
        detail: {
          size: x.size || size,
          visible: x.visible || visible,
          order: x.order || order,
          design: x.design || design,
        },
      }),
    );
  const chooseDesign = (v: Design) => {
    setDesign(v);
    localStorage.setItem("zf_assets_design", v);
    emit({ design: v });
  };
  const saveSettings = () => {
    localStorage.setItem(
      "zf_asset_table_v3",
      JSON.stringify({ size, visible, order }),
    );
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2200);
  };
  const applySize = (v: Size) => {
    setSize(v);
    emit({ size: v });
  };
  const move = (k: AssetColumn, d: number) => {
    const i = order.indexOf(k),
      j = i + d;
    if (j < 0 || j >= order.length) return;
    const n = [...order];
    [n[i], n[j]] = [n[j], n[i]];
    setOrder(n);
    emit({ order: n });
  };
  const preset = (p: string) => {
    let v: any = defaults(),
      s: Size = "normal",
      o: AssetColumn[] = orderDefault;
    if (p === "compact") {
      v = {
        ...v,
        weight: false,
        paid: false,
        remaining: false,
        calculation: false,
      };
      s = "compact";
      o = ["asset", "date", "hawl", "current", "due", "action"];
    }
    if (p === "dual") {
      v = {
        ...v,
        weight: false,
        cost: false,
        paid: false,
        remaining: false,
        calculation: false,
      };
      o = ["asset", "current", "due", "hawl", "action"];
    }
    setVisible(v);
    setSize(s);
    setOrder(o);
    emit({ visible: v, size: s, order: o });
  };
  const openDelete = async () => {
    const r = await fetch("/api/assets");
    if (r.ok) setAssets(await r.json());
  };
  const remove = async () => {
    if (!selected) return;
    const r = await fetch("/api/assets/" + selected, { method: "DELETE" }),
      j = await r.json().catch(() => ({}));
    if (r.ok) location.reload();
    else setMsg(j.error || (ar ? "تعذر الحذف" : "Delete failed"));
  };
  return (
    <>
      <style>{`.asset-table-tools{max-width:1240px;margin:14px auto -10px;padding:0 22px;position:relative}.att-bar{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}.att-panel{position:absolute;z-index:25;top:46px;inset-inline-end:22px;width:min(560px,calc(100vw - 44px));max-height:calc(100vh - 140px);overflow:auto;background:#fff;border:1px solid var(--line);border-radius:16px;padding:18px;box-shadow:0 18px 45px #0f231e26}.att-panel h4{margin:0 0 14px}.att-panel h5{margin:18px 0 8px;color:var(--muted)}.att-sizes,.att-presets,.att-designs{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:8px 0 14px}.att-sizes button,.att-presets button,.att-designs button,.att-save{min-height:38px;width:100%;display:flex;align-items:center;justify-content:center}.att-designs button.active{background:#0f7665;color:#fff}.att-cols{display:grid;grid-template-columns:1fr 1fr;gap:8px}.att-cols label{display:flex;align-items:center;gap:9px;min-height:42px;padding:9px 11px;border:1px solid var(--line);border-radius:10px;background:#fbfdfc;cursor:pointer}.att-cols label:has(input:checked){border-color:#16836f;background:#effaf6}.att-cols input{width:18px;height:18px;accent-color:#16836f}.att-order{display:grid;gap:7px}.att-order-row{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:42px;padding:7px 9px;border:1px solid var(--line);border-radius:10px;font-size:13px;background:#fbfdfc}.att-order-row>span:first-child{font-weight:600}.att-order-row button{width:32px;height:30px;padding:0!important;display:inline-flex;align-items:center;justify-content:center}.att-save{margin-top:18px;border:0;background:#0f7665;color:#fff;border-radius:10px;font-weight:700;cursor:pointer}.att-save.saved{background:#176b4f}.att-save:focus-visible,.att-panel button:focus-visible,.att-cols label:focus-within{outline:3px solid #b8e5d9;outline-offset:2px}.asset-report-table th{resize:horizontal;overflow:auto;min-width:72px;cursor:col-resize}.asset-report-table th:first-child{min-width:150px}@media(max-width:600px){.att-cols{grid-template-columns:1fr}.att-sizes,.att-presets,.att-designs{grid-template-columns:1fr}.att-panel{inset-inline-end:8px;width:calc(100vw - 16px)}}`}</style>
      <div className="asset-table-tools">
        <div className="att-bar">
          <button
            className="btn secondary"
            onClick={() =>
              applySize(
                size === "compact"
                  ? "normal"
                  : size === "normal"
                    ? "wide"
                    : "compact",
              )
            }
          >
            ↔ {ar ? "حجم الخانات" : "Cell size"}
          </button>
          <button className="btn secondary" onClick={() => setOpen(!open)}>
            ☷ {ar ? "تخصيص الجدول" : "Customize table"}
          </button>
          <button className="btn secondary" onClick={openDelete}>
            🗑 {ar ? "حذف أصل" : "Delete asset"}
          </button>
        </div>
        {open && (
          <div className="att-panel">
            <h4>{ar ? "النماذج وتخصيص الجدول" : "Modes & customization"}</h4>
            <div className="att-presets">
              <button className="btn" onClick={() => preset("compact")}>
                {ar ? "1 مضغوط" : "1 Compact"}
              </button>
              <button
                className="btn secondary"
                onClick={() => preset("custom")}
              >
                {ar ? "2 مخصص" : "2 Custom"}
              </button>
              <button className="btn secondary" onClick={() => preset("dual")}>
                {ar ? "3 مزدوج" : "3 Dual"}
              </button>
            </div>
            <h5>{ar ? "تصميم صفحة الأصول" : "Assets page design"}</h5>
            <div className="att-designs">
              {(
                [
                  ["executive", "1 تنفيذي"],
                  ["cards", "2 بطاقات"],
                  ["analytical", "3 تحليلي"],
                ] as const
              ).map(([v, label]) => (
                <button
                  key={v}
                  className={`btn ${design === v ? "active" : "secondary"}`}
                  onClick={() => chooseDesign(v)}
                >
                  {ar ? label : v}
                </button>
              ))}
            </div>
            <div className="att-sizes">
              <button className="btn" onClick={() => applySize("compact")}>
                {ar ? "صغير" : "Compact"}
              </button>
              <button
                className="btn secondary"
                onClick={() => applySize("normal")}
              >
                {ar ? "متوسط" : "Normal"}
              </button>
              <button
                className="btn secondary"
                onClick={() => applySize("wide")}
              >
                {ar ? "واسع" : "Wide"}
              </button>
            </div>
            <h5>{ar ? "ترتيب الأعمدة" : "Column order"}</h5>
            <div className="att-order">
              {order.map((k, i) => {
                const c = ASSET_COLS.find((x) => x[0] === k)!;
                return (
                  <div className="att-order-row" key={k}>
                    <span>☷ {ar ? c[1] : c[2]}</span>
                    <span>
                      <button
                        className="btn secondary"
                        disabled={!i}
                        onClick={() => move(k, -1)}
                      >
                        ↑
                      </button>
                      <button
                        className="btn secondary"
                        disabled={i === order.length - 1}
                        onClick={() => move(k, 1)}
                      >
                        ↓
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
            <h5>{ar ? "إظهار الأعمدة" : "Visible columns"}</h5>
            <div className="att-cols">
              {ASSET_COLS.map((c) => (
                <label key={c[0]}>
                  <input
                    type="checkbox"
                    checked={visible[c[0]] !== false}
                    onChange={(e) => {
                      const n = { ...visible, [c[0]]: e.target.checked };
                      setVisible(n);
                      emit({ visible: n });
                    }}
                  />
                  {ar ? c[1] : c[2]}
                </label>
              ))}
            </div>
            <button
              className={`att-save${saved ? " saved" : ""}`}
              onClick={saveSettings}
            >
              {saved
                ? ar
                  ? "✓ تم حفظ التخصيص"
                  : "✓ Customization saved"
                : ar
                  ? "حفظ الترتيب والأعمدة"
                  : "Save order & columns"}
            </button>
          </div>
        )}
        {assets.length > 0 && (
          <div className="att-panel" style={{ top: 92 }}>
            <h4>{ar ? "حذف أصل غير مستخدم" : "Delete unused asset"}</h4>
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              <option value="">{ar ? "اختر الأصل" : "Select asset"}</option>
              {assets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <button className="btn" disabled={!selected} onClick={remove}>
              {ar ? "حذف آمن" : "Safe delete"}
            </button>
            {msg && <p>{msg}</p>}
          </div>
        )}
      </div>
    </>
  );
}
