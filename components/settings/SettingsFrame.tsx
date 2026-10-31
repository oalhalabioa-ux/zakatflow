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
            {ar ? s.ar : s.en}
          </Link>
        ))}
      </nav>
      {children}
    </main>
  );
}
