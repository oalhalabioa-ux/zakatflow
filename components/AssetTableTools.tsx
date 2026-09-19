"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import {
  ASSET_COLUMNS,
  type AssetColumn,
  type AssetTablePreferences,
  type AssetTablePreset,
  type AssetTableSize,
  assetTablePreset,
  moveAssetColumn,
  parseAssetTablePreferences,
} from "@/lib/asset-table-preferences";

type AssetsPageDesign = "executive" | "cards" | "analytical";
type Panel = "table" | "design" | "delete" | null;

const TABLE_STORAGE_KEY = "zf_asset_table_v4";
const DESIGN_STORAGE_KEY = "zf_assets_design_v2";

function isAssetsPageDesign(value: unknown): value is AssetsPageDesign {
  return ["executive", "cards", "analytical"].includes(String(value));
}

export default function AssetTableTools({ ar }: { ar: boolean }) {
  const active = usePathname()?.includes("/assets");
  const [panel, setPanel] = useState<Panel>(null);
  const [settings, setSettings] = useState<AssetTablePreferences>(() =>
    assetTablePreset("professional"),
  );
  const [design, setDesign] = useState<AssetsPageDesign>("executive");
  const [dragged, setDragged] = useState<AssetColumn | null>(null);
  const [dragOver, setDragOver] = useState<AssetColumn | null>(null);
  const [assets, setAssets] = useState<any[]>([]);
  const [selected, setSelected] = useState("");
  const [msg, setMsg] = useState("");
  const [saved, setSaved] = useState(false);
  const [loadingAssets, setLoadingAssets] = useState(false);

  useEffect(() => {
    if (!active) return;
    const storedTable =
      localStorage.getItem(TABLE_STORAGE_KEY) ||
      localStorage.getItem("zf_asset_table_v3") ||
      localStorage.getItem("zf_asset_table_v2");
    setSettings(parseAssetTablePreferences(storedTable));

    const storedDesign =
      localStorage.getItem(DESIGN_STORAGE_KEY) ||
      localStorage.getItem("zf_assets_design");
    if (isAssetsPageDesign(storedDesign)) setDesign(storedDesign);
  }, [active]);

  if (!active) return null;

  const emitSettings = (next: AssetTablePreferences) => {
    window.dispatchEvent(
      new CustomEvent("zf-asset-table-settings", { detail: next }),
    );
  };

  const updateSettings = (
    update: (current: AssetTablePreferences) => AssetTablePreferences,
  ) => {
    const next = update(settings);
    setSettings(next);
    emitSettings(next);
    setSaved(false);
  };

  const choosePreset = (preset: AssetTablePreset) => {
    const next = assetTablePreset(preset);
    setSettings(next);
    emitSettings(next);
    setSaved(false);
  };

  const applySize = (size: AssetTableSize) =>
    updateSettings((current) => ({ ...current, size }));

  const reorder = (from: AssetColumn, to: AssetColumn) => {
    if (from === to) return;
    updateSettings((current) => {
      return { ...current, order: moveAssetColumn(current.order, from, to) };
    });
  };

  const move = (column: AssetColumn, direction: number) => {
    const index = settings.order.indexOf(column);
    const target = settings.order[index + direction];
    if (target) reorder(column, target);
  };

  const saveSettings = () => {
    localStorage.setItem(TABLE_STORAGE_KEY, JSON.stringify(settings));
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2200);
  };

  const chooseDesign = (next: AssetsPageDesign) => {
    setDesign(next);
    localStorage.setItem(DESIGN_STORAGE_KEY, next);
    window.dispatchEvent(
      new CustomEvent("zf-assets-page-design", { detail: { design: next } }),
    );
  };

  const openDelete = async () => {
    setPanel("delete");
    setLoadingAssets(true);
    setMsg("");
    try {
      const response = await fetch("/api/assets");
      if (!response.ok) throw new Error("LOAD_FAILED");
      setAssets(await response.json());
    } catch {
      setMsg(ar ? "تعذر تحميل قائمة الأصول" : "Could not load assets");
    } finally {
      setLoadingAssets(false);
    }
  };

  const remove = async () => {
    if (!selected) return;
    setMsg("");
    const response = await fetch(`/api/assets/${selected}`, {
      method: "DELETE",
    });
    const result = await response.json().catch(() => ({}));
    if (response.ok) {
      window.location.reload();
      return;
    }
    setMsg(result.error || (ar ? "تعذر الحذف" : "Delete failed"));
  };

  const togglePanel = (next: Exclude<Panel, null>) =>
    setPanel((current) => (current === next ? null : next));

  return (
    <>
      <style>{`
        .asset-table-tools{max-width:1240px;margin:14px auto -10px;padding:0 22px;position:relative}
        .att-bar{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}
        .att-panel{position:absolute;z-index:25;top:46px;inset-inline-end:22px;width:min(610px,calc(100vw - 44px));max-height:calc(100vh - 120px);overflow:auto;background:#fff;border:1px solid var(--line);border-radius:16px;padding:18px;box-shadow:0 18px 45px #0f231e26}
        .att-panel-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}
        .att-panel h4{margin:0}.att-panel h5{margin:20px 0 8px;color:var(--muted)}
        .att-close{border:0;background:transparent;color:var(--muted);font-size:20px;cursor:pointer}
        .att-presets{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}
        .att-preset{min-height:76px;text-align:start;padding:12px 14px;border:1px solid var(--line);border-radius:12px;background:#fff;color:var(--ink);cursor:pointer}
        .att-preset strong,.att-preset small{display:block}.att-preset small{margin-top:5px;color:var(--muted);line-height:1.5}
        .att-preset.active{background:#173f38;color:#fff;border-color:#173f38}.att-preset.active small{color:#d8e9e3}
        .att-sizes,.att-designs{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
        .att-sizes button,.att-designs button,.att-save{min-height:40px;width:100%;display:flex;align-items:center;justify-content:center}
        .att-sizes button.active,.att-designs button.active{background:#0f7665;color:#fff;border-color:#0f7665}
        .att-cols{display:grid;grid-template-columns:1fr 1fr;gap:8px}
        .att-cols label{display:flex;align-items:center;gap:9px;min-height:42px;padding:9px 11px;border:1px solid var(--line);border-radius:10px;background:#fbfdfc;cursor:pointer}
        .att-cols label:has(input:checked){border-color:#16836f;background:#effaf6}.att-cols input{width:18px;height:18px;accent-color:#16836f}
        .att-order{display:grid;gap:7px}.att-order-help{margin:0 0 9px;color:var(--muted);font-size:12px}
        .att-order-row{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:46px;padding:7px 9px;border:1px solid var(--line);border-radius:10px;font-size:13px;background:#fbfdfc;cursor:grab}
        .att-order-row.dragged{opacity:.45}.att-order-row.drag-over,.att-order-row:focus-visible{border-color:#16836f;background:#effaf6;box-shadow:inset 0 0 0 1px #16836f}
        .att-order-name{display:flex;align-items:center;gap:9px;font-weight:650}.att-drag-handle{font-size:18px;color:#5f746d}
        .att-order-actions{display:flex;gap:4px}.att-order-actions button{width:34px;height:32px;padding:0!important;display:inline-flex;align-items:center;justify-content:center}
        .att-save{margin-top:18px;border:0;background:#0f7665;color:#fff;border-radius:10px;font-weight:700;cursor:pointer}.att-save.saved{background:#176b4f}
        .att-note{padding:11px 12px;border-radius:10px;background:#f3f8f6;color:#526a62;font-size:13px;line-height:1.6}
        .att-delete-actions{display:flex;gap:8px;margin-top:12px}.att-delete-actions select{flex:1}
        .att-save:focus-visible,.att-panel button:focus-visible,.att-cols label:focus-within,.att-order-row:focus-visible{outline:3px solid #b8e5d9;outline-offset:2px}
        .asset-report-table th{min-width:72px}.asset-report-table th[data-column=asset]{min-width:150px}
        @media(max-width:600px){.att-cols{grid-template-columns:1fr}.att-presets,.att-sizes,.att-designs{grid-template-columns:1fr}.att-panel{inset-inline-end:8px;width:calc(100vw - 16px)}.att-bar{justify-content:stretch}.att-bar .btn{flex:1}}
      `}</style>
      <div className="asset-table-tools">
        <div className="att-bar">
          <button type="button" className="btn secondary" aria-expanded={panel === "design"} onClick={() => togglePanel("design")}>
            ◫ {ar ? "تصميم صفحة الأصول" : "Assets page design"}
          </button>
          <button type="button" className="btn secondary" aria-expanded={panel === "table"} onClick={() => togglePanel("table")}>
            ☷ {ar ? "تخصيص الجدول" : "Customize table"}
          </button>
          <button type="button" className="btn secondary" onClick={openDelete}>
            🗑 {ar ? "حذف أصل" : "Delete asset"}
          </button>
        </div>

        {panel === "table" && (
          <div className="att-panel" role="dialog" aria-label={ar ? "تخصيص جدول الأصول" : "Customize assets table"}>
            <div className="att-panel-head">
              <h4>{ar ? "تخصيص جدول الأصول" : "Customize assets table"}</h4>
              <button className="att-close" type="button" onClick={() => setPanel(null)} aria-label={ar ? "إغلاق" : "Close"}>×</button>
            </div>
            <div className="att-presets">
              <button type="button" className={`att-preset${settings.preset === "professional" ? " active" : ""}`} onClick={() => choosePreset("professional")}>
                <strong>{ar ? "النموذج الاحترافي" : "Professional model"}</strong>
                <small>{ar ? "جميع الأعمدة والتفاصيل المالية والزكوية" : "All financial and Zakat columns"}</small>
              </button>
              <button type="button" className={`att-preset${settings.preset === "zakat" ? " active" : ""}`} onClick={() => choosePreset("zakat")}>
                <strong>{ar ? "نموذج الزكاة والسداد" : "Zakat & payment model"}</strong>
                <small>{ar ? "الاستحقاق والمدفوع والمتبقي والحول" : "Due, paid, remaining and Hawl"}</small>
              </button>
            </div>

            <h5>{ar ? "حجم الخانات" : "Cell size"}</h5>
            <div className="att-sizes">
              {(["compact", "normal", "wide"] as const).map((size) => (
                <button type="button" key={size} className={`btn secondary${settings.size === size ? " active" : ""}`} onClick={() => applySize(size)}>
                  {ar ? { compact: "صغير", normal: "متوسط", wide: "واسع" }[size] : { compact: "Compact", normal: "Normal", wide: "Wide" }[size]}
                </button>
              ))}
            </div>

            <h5>{ar ? "ترتيب الأعمدة" : "Column order"}</h5>
            <p className="att-order-help">{ar ? "اسحب العمود وأفلته في موضعه الجديد، أو استخدم الأسهم." : "Drag and drop a column, or use the arrow buttons."}</p>
            <div className="att-order">
              {settings.order.map((key, index) => {
                const column = ASSET_COLUMNS.find(([id]) => id === key)!;
                return (
                  <div
                    className={`att-order-row${dragged === key ? " dragged" : ""}${dragOver === key ? " drag-over" : ""}`}
                    key={key}
                    draggable
                    tabIndex={0}
                    onDragStart={(event) => {
                      setDragged(key);
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", key);
                    }}
                    onDragEnd={() => {
                      setDragged(null);
                      setDragOver(null);
                    }}
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                      setDragOver(key);
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      const from = event.dataTransfer.getData("text/plain") as AssetColumn;
                      reorder(from, key);
                      setDragged(null);
                      setDragOver(null);
                    }}
                  >
                    <span className="att-order-name"><span className="att-drag-handle" aria-hidden="true">⠿</span>{ar ? column[1] : column[2]}</span>
                    <span className="att-order-actions">
                      <button type="button" className="btn secondary" disabled={index === 0} onClick={() => move(key, -1)} aria-label={ar ? "تحريك للأعلى" : "Move up"}>↑</button>
                      <button type="button" className="btn secondary" disabled={index === settings.order.length - 1} onClick={() => move(key, 1)} aria-label={ar ? "تحريك للأسفل" : "Move down"}>↓</button>
                    </span>
                  </div>
                );
              })}
            </div>

            <h5>{ar ? "إظهار الأعمدة" : "Visible columns"}</h5>
            <div className="att-cols">
              {ASSET_COLUMNS.map(([key, arabic, english]) => (
                <label key={key}>
                  <input
                    type="checkbox"
                    checked={settings.visible[key] !== false}
                    disabled={
                      settings.visible[key] !== false &&
                      Object.values(settings.visible).filter(Boolean).length === 1
                    }
                    onChange={(event) => updateSettings((current) => ({ ...current, visible: { ...current.visible, [key]: event.target.checked } }))}
                  />
                  {ar ? arabic : english}
                </label>
              ))}
            </div>
            <button type="button" className={`att-save${saved ? " saved" : ""}`} onClick={saveSettings}>
              {saved ? (ar ? "✓ تم حفظ التخصيص" : "✓ Customization saved") : (ar ? "حفظ النموذج والتخصيص" : "Save model & customization")}
            </button>
          </div>
        )}

        {panel === "design" && (
          <div className="att-panel" role="dialog" aria-label={ar ? "تصميم صفحة الأصول" : "Assets page design"}>
            <div className="att-panel-head">
              <h4>{ar ? "تصميم صفحة الأصول" : "Assets page design"}</h4>
              <button className="att-close" type="button" onClick={() => setPanel(null)} aria-label={ar ? "إغلاق" : "Close"}>×</button>
            </div>
            <p className="att-note">{ar ? "هذا الخيار مستقل عن نموذج الجدول وترتيب أعمدته." : "This setting is independent from the table model and column order."}</p>
            <div className="att-designs">
              {(["executive", "cards", "analytical"] as const).map((value) => (
                <button type="button" key={value} className={`btn secondary${design === value ? " active" : ""}`} onClick={() => chooseDesign(value)}>
                  {ar ? { executive: "تنفيذي", cards: "بطاقات", analytical: "تحليلي" }[value] : { executive: "Executive", cards: "Cards", analytical: "Analytical" }[value]}
                </button>
              ))}
            </div>
          </div>
        )}

        {panel === "delete" && (
          <div className="att-panel" role="dialog" aria-label={ar ? "حذف أصل" : "Delete asset"}>
            <div className="att-panel-head">
              <h4>{ar ? "حذف أصل غير مستخدم" : "Delete unused asset"}</h4>
              <button className="att-close" type="button" onClick={() => setPanel(null)} aria-label={ar ? "إغلاق" : "Close"}>×</button>
            </div>
            {loadingAssets ? (
              <p className="muted">{ar ? "جارٍ تحميل الأصول…" : "Loading assets…"}</p>
            ) : assets.length ? (
              <div className="att-delete-actions">
                <select value={selected} onChange={(event) => setSelected(event.target.value)}>
                  <option value="">{ar ? "اختر الأصل" : "Select asset"}</option>
                  {assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}
                </select>
                <button type="button" className="btn danger" disabled={!selected} onClick={remove}>{ar ? "حذف آمن" : "Safe delete"}</button>
              </div>
            ) : (
              <p className="muted">{ar ? "لا توجد أصول متاحة للحذف." : "No assets are available to delete."}</p>
            )}
            {msg && <p className="notice">{msg}</p>}
          </div>
        )}
      </div>
    </>
  );
}
