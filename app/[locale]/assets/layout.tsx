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
          className={`card section metal-price-panel${open ? " is-open" : ""}`}
          style={{ marginBottom: 0 }}
        >
          <button
            className="metal-price-toggle"
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
          >
            <span>
              {ar
                ? "أسعار السوق الحالية للمعادن"
                : "Current metal market prices"}
            </span>
            <span aria-hidden="true">{open ? "−" : "+"}</span>
          </button>
          {open && (
            <p className="muted metal-price-help">
              {ar ? "تحديث القيمة الحالية فقط." : "Updates current value only."}
            </p>
          )}
          {open && (
            <div
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
