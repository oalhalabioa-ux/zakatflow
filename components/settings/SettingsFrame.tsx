"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { rememberedOrganization } from "@/lib/workspace-organization";
import { settingSections, isSettingsSectionActive } from "./navigation";
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
  const [fromSetup,setFromSetup]=useState(false);
  useEffect(() => {
    const read = () => {
      const query=new URLSearchParams(location.search);
      setOrganization(query.get("organization") ?? rememberedOrganization() ?? "");
      setFromSetup(query.get("fromSetup")==='1');
    };
    read();
    window.addEventListener("zf-organization-selection", read);
    window.addEventListener("popstate", read);
      return () => {
      window.removeEventListener("zf-organization-selection", read);
      window.removeEventListener("popstate", read);
    };
  }, [path]);
  const tabParams=new URLSearchParams();
  if(organization)tabParams.set('organization',organization);
  if(fromSetup)tabParams.set('fromSetup','1');
  const relativePath=path.split('/').slice(2).join('/');
  const active=settingSections.find(s=>s.group==='primary'&&isSettingsSectionActive(relativePath,s.path));
  const journey=active?.path==='settings/financial/setup';
  const heading=journey?(ar?'رحلة إعداد المؤسسة':'Set up your organization'):(active?(ar?active.ar:active.en):(ar?'الإعدادات':'Settings'));

  return (
    <main className="settings-workspace" dir={ar ? "rtl" : "ltr"}>
      <header className="settings-heading">
        <p className="settings-breadcrumb">{ar?"الإعدادات / ":"Settings / "}{heading}</p>
        <h1>{heading}</h1>
        <p>
          {ar
            ? "إدارة هوية المؤسسة والتأسيس المالي والصلاحيات وتفضيلات النظام."
            : "Manage organization identity, financial setup, access and preferences."}
        </p>
      </header>
      <nav
        className="settings-tabs"
        aria-label={ar ? "أقسام الإعدادات" : "Settings sections"}
      >
        {settingSections.filter(s=>s.group==='primary').map((s) => (
          <Link
            key={s.path}
            href={`/${locale}/${s.path}${tabParams.size?'?'+tabParams:''}`}
            aria-current={isSettingsSectionActive(path.split("/").slice(2).join("/"),s.path) ? "page" : undefined}
          >
            <svg className="settings-tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {s.icon==='journey'?<><path d="M5 19c0-5 4-6 7-6s7-3 7-8"/><path d="m14 5 5 0 0 5"/><circle cx="5" cy="19" r="2"/><circle cx="12" cy="13" r="2"/></>:s.icon==='finance'?<><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7"/></>:s.icon==='regulatory'?<><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h3"/></>:s.icon==='users'?<><circle cx="10" cy="8" r="3"/><path d="M3 21v-3c0-4 3-6 7-6s7 2 7 6v3M20 9v8M16 13h8"/></>:s.icon==='organization'?<><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 7h2m4 0h2M8 11h2m4 0h2M10 21v-6h4v6"/></>:<><circle cx="12" cy="12" r="3"/><path d="m9 3-1 3-3 1-2 4 2 2v3l3 2 1 3h6l1-3 3-2v-3l2-2-2-4-3-1-1-3Z"/></>}
            </svg><span>{ar ? s.ar : s.en}</span>
          </Link>
        ))}
      </nav>
      <nav className="settings-secondary-links" aria-label={ar?'الإعدادات الأخرى':'Other settings'}>
        {settingSections.filter(s=>s.group==='secondary').map(s=><Link key={s.path}
          href={`/${locale}/${s.path}${tabParams.size?'?'+tabParams:''}`}
          aria-current={isSettingsSectionActive(path.split('/').slice(2).join('/'),s.path)?'page':undefined}>
          {ar?s.ar:s.en}
        </Link>)}
      </nav>
      {children}
    </main>
  );
}
