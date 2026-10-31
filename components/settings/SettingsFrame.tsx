"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { rememberedOrganization } from "@/lib/workspace-organization";
import { settingSections } from "./navigation";
import "./settings.css";
export default function SettingsFrame({
  locale,
  children,
}: {
  locale: string;
  children: ReactNode;
}) {
  const ar = locale === "ar",
    path = usePathname(),
    [organization, setOrganization] = useState("");
  useEffect(() => {
    const read = () =>
      setOrganization(
        new URLSearchParams(location.search).get("organization") ??
          rememberedOrganization() ??
          "",
      );
    read();
    window.addEventListener("zf-organization-selection", read);
    window.addEventListener("popstate", read);
    return () => {
      window.removeEventListener("zf-organization-selection", read);
      window.removeEventListener("popstate", read);
    };
  }, [path]);
  return (
    <main className="settings-workspace" dir={ar ? "rtl" : "ltr"}>
      <header className="settings-heading">
        <h1>{ar ? "الإعدادات" : "Settings"}</h1>
        <p>
          {ar
            ? "إدارة بيانات المؤسسة واشتراكها وإعداداتها."
            : "Manage organization details, subscription and settings."}
        </p>
      </header>
      <nav
        className="settings-tabs"
        aria-label={ar ? "أقسام الإعدادات" : "Settings sections"}
      >
        {settingSections.map((s) => (
          <Link
            key={s.path}
            href={`/${locale}/${s.path}${organization ? "?organization=" + encodeURIComponent(organization) : ""}`}
            aria-current={path === `/${locale}/${s.path}` ? "page" : undefined}
          >
            <svg className="settings-tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {s.icon==='organization'?<><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 7h2m4 0h2M8 11h2m4 0h2M10 21v-6h4v6"/></>:s.icon==='payments'?<><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h4"/></>:<><circle cx="12" cy="12" r="3"/><path d="m9 3-1 3-3 1-2 4 2 2v3l3 2 1 3h6l1-3 3-2v-3l2-2-2-4-3-1-1-3Z"/></>}
            </svg><span>{ar ? s.ar : s.en}</span>
          </Link>
        ))}
      </nav>
      {children}
    </main>
  );
}
