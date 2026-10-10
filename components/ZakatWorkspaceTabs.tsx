"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const pages = [
  { route: "dashboard", ar: "الداشبورد", en: "Dashboard" },
  { route: "assets", ar: "الأصول", en: "Assets" },
  { route: "transactions", ar: "العمليات", en: "Transactions" },
  { route: "assessments", ar: "احتساب الزكاة", en: "Zakat assessment" },
  { route: "payments", ar: "دفعات الزكاة", en: "Zakat payments" },
] as const;

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
          {ar ? page.ar : page.en}
        </Link>
      ))}
    </nav>
  );
}
