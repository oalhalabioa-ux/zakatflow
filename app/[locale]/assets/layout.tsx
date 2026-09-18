"use client";
import type { ReactNode } from "react";
import { useParams } from "next/navigation";
import MetalMarketPriceControl from "@/components/MetalMarketPriceControl";

export default function AssetsLayout({ children }: { children: ReactNode }) {
  const params = useParams<{ locale: string }>();
  const ar = params?.locale === "ar";
  const refresh = () => {
    window.location.reload();
  };
  return (
    <>
      <div className="container metal-price-strip" style={{ paddingBottom: 0 }}>
        <section className="card section" style={{ marginBottom: 0 }}>
          <div className="page-head" style={{ marginBottom: 6 }}>
            <div>
              <h3 style={{ margin: 0 }}>
                {ar
                  ? "أسعار السوق الحالية للمعادن"
                  : "Current metal market prices"}
              </h3>
              <p
                className="muted metal-price-help"
                style={{ margin: "4px 0 0" }}
              >
                {ar
                  ? "تحديث السعر يعيد تقييم القيمة الحالية فقط."
                  : "Updates current value only."}
              </p>
            </div>
          </div>
          <div
            className="metal-price-grid"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2,minmax(0,1fr))",
              gap: 8,
            }}
          >
            <MetalMarketPriceControl type="GOLD" ar={ar} onUpdated={refresh} />
            <MetalMarketPriceControl
              type="SILVER"
              ar={ar}
              onUpdated={refresh}
            />
          </div>
        </section>
      </div>
      {children}
    </>
  );
}
