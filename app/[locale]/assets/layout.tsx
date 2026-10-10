"use client";
import type { ReactNode } from "react";
import { useParams } from "next/navigation";
import { useState } from "react";
import MetalMarketPriceControl from "@/components/MetalMarketPriceControl";

export default function AssetsLayout({ children }: { children: ReactNode }) {
  const params = useParams<{ locale: string }>();
  const ar = params?.locale === "ar";
  const [open, setOpen] = useState(false);
  const refresh = () => {
    window.location.reload();
  };
  return (
    <>
      <div className="container metal-price-strip" style={{ paddingBottom: 0 }}>
        <section
          className={`metal-price-panel${open ? " card section is-open" : ""}`}
          style={{ marginBottom: 0 }}
        >
          <button
            className="metal-price-toggle"
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            aria-controls="metal-market-prices"
            aria-label={ar ? "أسعار السوق الحالية للمعادن" : "Current metal market prices"}
            title={ar ? "أسعار السوق الحالية للمعادن" : "Current metal market prices"}
          >
            <svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 4v16h16M7 15l4-4 3 2 6-7M16 6h4v4"/>
            </svg>
          </button>
          {open && (
            <p className="muted metal-price-help">
              {ar ? "تحديث القيمة الحالية فقط." : "Updates current value only."}
            </p>
          )}
          {open && (
            <div
              id="metal-market-prices"
              className="metal-price-grid"
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2,minmax(0,1fr))",
                gap: 8,
              }}
            >
              <MetalMarketPriceControl
                type="GOLD"
                ar={ar}
                onUpdated={refresh}
              />
              <MetalMarketPriceControl
                type="SILVER"
                ar={ar}
                onUpdated={refresh}
              />
            </div>
          )}
        </section>
      </div>
      {children}
    </>
  );
}
