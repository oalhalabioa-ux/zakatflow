import {
  ConsoleIcon,
  type ConsoleIconName,
} from "@/components/subscriptions/OwnerSubscriptionVisuals";
import { adminNumber } from "@/lib/admin/metrics";
export type OwnerMetric = {
  label: string;
  value: number | string | null;
  note?: string;
  icon: ConsoleIconName;
  tone?: "accent" | "success" | "warning" | "muted";
};
export default function OwnerMetrics({
  items,
  locale,
}: {
  items: OwnerMetric[];
  locale: string;
}) {
  return (
    <div
      className="owner-kpis owner-metrics"
      aria-label={locale === "ar" ? "مؤشرات الصفحة" : "Page metrics"}
    >
      {items.map((item) => (
        <article
          key={item.label}
          className="owner-metric-card"
          data-tone={item.tone || "accent"}
        >
          <header>
            <span>{item.label}</span>
            <ConsoleIcon name={item.icon} />
          </header>
          <strong>
            <bdi>
              {item.value === null
                ? "—"
                : typeof item.value === "number"
                  ? adminNumber(item.value, locale)
                  : item.value}
            </bdi>
          </strong>
          {item.note && <small>{item.note}</small>}
        </article>
      ))}
    </div>
  );
}
