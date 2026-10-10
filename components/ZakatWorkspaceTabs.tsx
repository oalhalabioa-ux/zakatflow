"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

const pages = [
  { route: "dashboard", ar: "الداشبورد", en: "Dashboard" },
  { route: "assets", ar: "الأصول", en: "Assets" },
  { route: "transactions", ar: "العمليات", en: "Transactions" },
  { route: "assessments", ar: "احتساب الزكاة", en: "Zakat assessment" },
  { route: "payments", ar: "دفعات الزكاة", en: "Zakat payments" },
] as const;

const icons: Record<(typeof pages)[number]["route"], ReactNode> = {
  dashboard: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
  assets: <><path d="M4 7h16v12H4zM7 4h10v3M8 12h8M8 16h5"/></>,
  transactions: <><path d="M4 7h14M14 3l4 4-4 4M20 17H6M10 13l-4 4 4 4"/></>,
  assessments: <><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 11h2M14 11h2M8 15h2M14 15h2M8 18h8"/></>,
  payments: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18m-7 5 2 2 4-4"/></>,
};


export default function ZakatWorkspaceTabs({ locale }: { locale: string }) {
  const pathname = usePathname();
  const activeRoute = pathname?.split("/")[2];
  if (!pages.some((page) => page.route === activeRoute)) return null;

  const ar = locale === "ar";
  return (
    <nav
      className="zakat-workspace-tabs"
      aria-label={ar ? "صفحات الأصول والزكاة" : "Assets and Zakat pages"}
    >
      {pages.map((page) => (
        <Link
          key={page.route}
          href={`/${locale}/${page.route}`}
          aria-current={activeRoute === page.route ? "page" : undefined}
        >
          <svg className="zakat-tab-icon" aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{icons[page.route]}</svg>
          <span>{ar ? page.ar : page.en}</span>
        </Link>
      ))}
    </nav>
  );
}
