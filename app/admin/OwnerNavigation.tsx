"use client";
import { ownerTranslator, ownerHref } from "@/lib/i18n/owner";
import type { Locale } from "@/lib/routing";

import Link from "next/link";
import type { ReactNode, MouseEvent } from "react";
import {
  ownerSubscriptionSections,
  updateOwnerQuery,
} from "@/lib/subscriptions/owner-query";
import OwnerThemeSelector from "./OwnerThemeSelector";
import { usePathname, useSearchParams } from "next/navigation";
type NavIcon =
  "home" | "users" | "building" | "card" | "wallet" | "chart" | "settings";
function Icon({ name }: { name: NavIcon }) {
  const paths: Record<NavIcon, ReactNode> = {
    home: (
      <>
        <path d="m3 10 9-7 9 7" />
        <path d="M5 9v12h14V9M9 21v-8h6v8" />
      </>
    ),
    users: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M3 20v-2a6 6 0 0 1 12 0v2M17 5a3 3 0 0 1 0 6M17 14a5 5 0 0 1 4 5v1" />
      </>
    ),
    building: (
      <>
        <rect x="4" y="3" width="16" height="18" rx="2" />
        <path d="M9 7h2m2 0h2M9 11h2m2 0h2M9 15h2m2 0h2M10 21v-3h4v3" />
      </>
    ),
    card: (
      <>
        <rect x="2" y="5" width="20" height="14" rx="3" />
        <path d="M2 10h20M6 15h4" />
      </>
    ),
    wallet: (
      <>
        <rect x="3" y="5" width="18" height="15" rx="3" />
        <path d="M3 9h18M16 13h5v4h-5a2 2 0 0 1 0-4Z" />
      </>
    ),
    chart: (
      <>
        <path d="M4 20V11m5 9V5m5 15v-7m5 7V8M2 21h20" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M10 2h4l.6 2.3 2 .9 2.1-1.1 2.8 2.8-1.1 2.1.9 2L23 12l-1.7 1-.9 2 1.1 2.1-2.8 2.8-2.1-1.1-2 .9L14 22h-4l-.6-2.3-2-.9-2.1 1.1-2.8-2.8 1.1-2.1-.9-2L1 12l1.7-1 .9-2-1.1-2.1 2.8-2.8 2.1 1.1 2-.9Z" />
      </>
    ),
  };
  return (
    <svg
      className="owner-nav-symbol"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
const sections = [
  { href: "/admin", label: "الرئيسية", icon: "home" },
  { href: "/admin/users", label: "المستخدمون", icon: "users" },
  { href: "/admin/companies", label: "الشركات", icon: "building" },
  { href: "/admin/subscriptions", label: "الاشتراكات", icon: "card" },
  { href: "/admin/payments", label: "المدفوعات", icon: "wallet" },
  { href: "/admin/analytics", label: "التحليلات", icon: "chart" },
  { href: "/admin/settings", label: "الإعدادات", icon: "settings" },
] as const;
export default function OwnerNavigation({
  variant = "tabs",
  locale = "ar",
}: {
  variant?: "tabs" | "sidebar";
  locale?: Locale;
}) {
  const translate = ownerTranslator(locale),
    pathname = usePathname(),
    query = useSearchParams();
  const languageHref = ownerHref(
    `${pathname}?${query.toString()}`,
    locale === "ar" ? "en" : "ar",
  );
  function selectSection(event: MouseEvent<HTMLAnchorElement>, id: string) {
    if (
      pathname !== "/admin/subscriptions" ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      event.button !== 0
    )
      return;
    event.preventDefault();
    updateOwnerQuery({ tab: id }, true);
  }
  const navigation = (
    <nav
      className={
        variant === "tabs" ? "owner-section-nav owner-tabs" : "owner-side-links"
      }
      aria-label={
        variant === "tabs"
          ? translate("تبويبات إدارة المنصة")
          : translate("القائمة الجانبية لإدارة المنصة")
      }
    >
      {sections.map((s) => {
        const active =
          pathname === s.href ||
          (s.href !== "/admin" && pathname.startsWith(s.href + "/"));
        const link = (
          <Link
            href={ownerHref(s.href, locale)}
            aria-label={translate(s.label)}
            title={translate(s.label)}
            aria-current={active ? "page" : undefined}
            className={active ? "selected" : undefined}
          >
            <Icon name={s.icon} />
            <span>{translate(s.label)}</span>
          </Link>
        );
        return variant === "sidebar" && s.icon === "card" ? (
          <div key={s.href} className="owner-side-group">
            {link}
            {active && (
              <div
                className="owner-sub-links"
                aria-label={
                  locale === "ar" ? "أقسام الاشتراكات" : "Subscription sections"
                }
              >
                {ownerSubscriptionSections.map((section) => (
                  <Link
                    key={section.id}
                    href={ownerHref(
                      "/admin/subscriptions?" +
                        new URLSearchParams({
                          ...Object.fromEntries(query),
                          tab: section.id,
                        }).toString(),
                      locale,
                    )}
                    onClick={(e) => selectSection(e, section.id)}
                    className={
                      (query.get("tab") || "institutions") === section.id
                        ? "selected"
                        : undefined
                    }
                    aria-current={
                      (query.get("tab") || "institutions") === section.id
                        ? "page"
                        : undefined
                    }
                  >
                    <span>{locale === "ar" ? section.ar : section.en}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        ) : (
          <span className="owner-nav-item" key={s.href}>
            {link}
          </span>
        );
      })}
    </nav>
  );
  return variant === "sidebar" ? (
    navigation
  ) : (
    <div className="owner-navigation-row">
      {navigation}
      <div className="owner-toolbar-controls">
        <Link
          className="owner-language-control"
          href={languageHref}
          lang={locale === "ar" ? "en" : "ar"}
          aria-label={
            locale === "ar" ? "Switch to English" : "التبديل إلى العربية"
          }
        >
          <svg
            viewBox="0 0 24 24"
            width="19"
            height="19"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="9" />
            <ellipse cx="12" cy="12" rx="4" ry="9" />
            <path d="M3 12h18M5 7h14M5 17h14" />
          </svg>
          <span>{locale === "ar" ? "English" : "العربية"}</span>
        </Link>
        <div className="owner-tabs-theme">
          <OwnerThemeSelector locale={locale} />
        </div>
      </div>
    </div>
  );
}
