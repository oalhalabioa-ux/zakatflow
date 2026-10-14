"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

const pages = [
  { route: "assets/dashboard", ar: "لوحة الأصول", en: "Assets dashboard" },
  { route: "assets", ar: "الأصول", en: "Assets" },
  { route: "cash-and-banks", ar: "النقد والبنوك", en: "Cash & banks" },
  { route: "receivables", ar: "الذمم المدينة", en: "Receivables" },
  { route: "investments", ar: "الاستثمارات", en: "Investments" },
  { route: "transactions", ar: "العمليات", en: "Transactions" },
  { route: "assessments", ar: "احتساب الزكاة", en: "Zakat assessment" },
  { route: "payments", ar: "دفعات الزكاة", en: "Zakat payments" },
] as const;

const icons: Record<(typeof pages)[number]["route"], ReactNode> = {
  "assets/dashboard": <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
  assets: <><path d="M4 7h16v12H4zM7 4h10v3M8 12h8M8 16h5"/></>,
  "cash-and-banks": <><path d="m3 8 9-5 9 5H3ZM4 21h16M7 10v7M12 10v7M17 10v7"/></>,
  receivables: <><circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 6h5M18 3l3 3-3 3M21 15h-5m3-3-3 3 3 3"/></>,
  investments: <><path d="m3 8 9-5 9 5H3ZM4 21h16M5 18h14M7 10v6M12 10v6M17 10v6"/></>,
  transactions: <><path d="M4 7h14M14 3l4 4-4 4M20 17H6M10 13l-4 4 4 4"/></>,
  assessments: <><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 11h2M14 11h2M8 15h2M14 15h2M8 18h8"/></>,
  payments: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18m-7 5 2 2 4-4"/></>,
};


export default function ZakatWorkspaceTabs({ locale }: { locale: string }) {
  const pathname = usePathname();
  const tail = pathname?.split("/").slice(2).join("/") || "";
  const activeRoute = tail.startsWith("dashboard/report") ? "assets/dashboard" : pages.find(page=>tail===page.route || tail.startsWith(`${page.route}/`))?.route;
  if (!pages.some((page) => page.route === activeRoute)) return null;

  const ar = locale === "ar";
  return (
    <nav
      className="zakat-workspace-tabs"
      aria-label={ar ? "صفحات الأصول والاستثمارات والزكاة" : "Assets, Investments and Zakat pages"}
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
