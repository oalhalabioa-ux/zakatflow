"use client";

import { useState } from "react";
import AssetTableTools from "@/components/AssetTableTools";
import MetalMarketPriceControl from "@/components/MetalMarketPriceControl";

export default function AssetsPageToolbar({ ar, onAdd, onUsage, usageOpen }: {
  ar: boolean;
  onAdd: () => void;
  onUsage: () => void;
  usageOpen: boolean;
}) {
  const [marketOpen, setMarketOpen] = useState(false);
  return (
    <>
      <div className="assets-command-bar" role="group" aria-label={ar ? "أدوات صفحة الأصول" : "Assets page tools"}>
        <button type="button" className="btn assets-add-button" onClick={onAdd}>{ar ? "＋ إضافة أصل" : "＋ Add asset"}</button>
        <div className="assets-command-secondary">
          <button type="button" className="asset-toolbar-icon" onClick={onUsage} aria-expanded={usageOpen} aria-label={ar ? "إعداد الاستخدام" : "Usage settings"} title={ar ? "إعداد الاستخدام" : "Usage settings"}>
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="12" cy="12" r="3"/><path d="M19 12l2-1-2-4-2 1-2-2V4h-6v2L7 8 5 7l-2 4 2 1v2l-2 1 2 4 2-1 2 2v2h6v-2l2-2 2 1 2-4-2-1z"/></svg>
          </button>
          <button type="button" className="asset-toolbar-icon" onClick={() => setMarketOpen(!marketOpen)} aria-expanded={marketOpen} aria-controls="asset-market-panel" aria-label={ar ? "أسعار السوق الحالية للمعادن" : "Current metal market prices"} title={ar ? "أسعار السوق الحالية للمعادن" : "Current metal market prices"}>
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4v16h16M7 15l4-4 3 2 6-7M16 6h4v4"/></svg>
          </button>
          <AssetTableTools ar={ar}/>
        </div>
      </div>
      {marketOpen && <section id="asset-market-panel" className="card section assets-market-panel">
        <p className="muted">{ar ? "تحديث القيمة الحالية فقط." : "Updates current value only."}</p>
        <div className="assets-market-grid">
          <MetalMarketPriceControl type="GOLD" ar={ar} onUpdated={() => window.location.reload()}/>
          <MetalMarketPriceControl type="SILVER" ar={ar} onUpdated={() => window.location.reload()}/>
        </div>
      </section>}
    </>
  );
}
