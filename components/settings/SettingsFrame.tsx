"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { rememberedOrganization } from "@/lib/workspace-organization";
import { settingSections, isSettingsSectionActive } from "./navigation";
import "./settings.css";
import "./settings-refinement.css";
import SettingsIcon from "./SettingsIcon";
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

      const descriptions:Record<string,[string,string]>={
    'settings':['إدارة هوية المؤسسة وهيكلها التنظيمي وبياناتها الأساسية.','Manage your organization identity, structure and contact details.'],
    'settings/regulatory':['تختلف المتطلبات النظامية والضريبية حسب الدولة وطبيعة نشاط المؤسسة.','Legal and tax requirements depend on your country and business activity.'],
    'settings/financial':['بناء أساس محاسبي موثوق لتنظيم العمليات المالية وإعداد التقارير بدقة.','Build a reliable accounting foundation for operations and reporting.'],
    'settings/team':['وصول آمن ومنظم للفريق عبر أدوار تشغيلية وصلاحيات واضحة.','Manage secure team access through clear roles and permissions.'],
    'settings/system':['تفضيلات عامة للمنصة، مستقلة عن الملف القانوني للمؤسسة.','Platform preferences, separate from the organization legal profile.'],
  };
  const description=journey?(ar?'دليلك لإكمال إعداد المؤسسة والوصول إلى الجاهزية للعمل على يقين.':'Complete organization setup and prepare to work in Yaqeen.'):(descriptions[active?.path??'settings']??descriptions.settings)[ar?0:1];

  return (
    <main className="settings-workspace" dir={ar ? "rtl" : "ltr"}>
      <header className="settings-heading">
        <p className="settings-breadcrumb">{ar?"الإعدادات / ":"Settings / "}{heading}</p>
        <h1>{heading}</h1>
        <p>{description}</p>
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
            <SettingsIcon name={s.icon==='settings'?'system':s.icon}/><span>{ar ? s.ar : s.en}</span>
          </Link>
        ))}
      </nav>
      {children}
    </main>
  );
}
