"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { rememberedOrganization } from "@/lib/workspace-organization";
import { useWorkspaceScope } from "@/hooks/useWorkspaceScope";
import { settingSections, isSettingsSectionActive } from "./navigation";
import "./settings.css";
import "./settings-refinement.css";
import "./settings-navigation-refinement.css";
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
  const relativePath=path.split('/').slice(2).join('/');
  const [scope]=useWorkspaceScope(relativePath==='settings/personal-setup'?'PERSONAL':'ORGANIZATION');
  const personal=relativePath==='settings/personal-setup'||relativePath==='settings/system'&&scope==='PERSONAL';
  const [fromSetup,setFromSetup]=useState(false);
  useEffect(() => {
    const read = () => {
      const query=new URLSearchParams(location.search);
      setOrganization(query.get("organization") ?? query.get("organization_id") ?? rememberedOrganization() ?? "");
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
  tabParams.set('scope',personal?'PERSONAL':'ORGANIZATION');
  if(!personal&&organization)tabParams.set('organization',organization);
  if(!personal&&fromSetup)tabParams.set('fromSetup','1');
  const sections=settingSections.filter(s=>s.group==='primary'&&(!personal||['settings/financial/setup','settings/system'].includes(s.path)))
    .map(s=>personal&&s.path==='settings/financial/setup'?{...s,path:'settings/personal-setup',ar:'الإعداد الشخصي',en:'Personal setup'}:s);
  const active=sections.find(s=>isSettingsSectionActive(relativePath,s.path));
  const journey=active?.path==='settings/financial/setup'||active?.path==='settings/personal-setup';
  const heading=journey?(personal?(ar?'رحلة الإعداد الشخصي':'Set up your personal workspace'):(ar?'رحلة إعداد المؤسسة':'Set up your organization')):(active?(ar?active.ar:active.en):(ar?'الإعدادات':'Settings'));

      const descriptions:Record<string,[string,string]>={
    'settings':['إدارة هوية المؤسسة وهيكلها التنظيمي وبياناتها الأساسية.','Manage your organization identity, structure and contact details.'],
    'settings/regulatory':['تختلف المتطلبات النظامية والضريبية حسب الدولة وطبيعة نشاط المؤسسة.','Legal and tax requirements depend on your country and business activity.'],
    'settings/financial':['بناء أساس محاسبي موثوق لتنظيم العمليات المالية وإعداد التقارير بدقة.','Build a reliable accounting foundation for operations and reporting.'],
    'settings/team':['وصول آمن ومنظم للفريق عبر أدوار تشغيلية وصلاحيات واضحة.','Manage secure team access through clear roles and permissions.'],
    'settings/system':['تفضيلات عامة للمنصة، مستقلة عن الملف القانوني للمؤسسة.','Platform preferences, separate from the organization legal profile.'],
  };
  const description=journey?(personal?(ar?'تفضيلاتك ومصادرك المالية وتقاريرك الشخصية، دون الحاجة إلى إنشاء مؤسسة.':'Your preferences, financial sources and personal reports, without creating an organization.'):(ar?'دليلك لإكمال إعداد المؤسسة والوصول إلى الجاهزية للعمل على يقين.':'Complete organization setup and prepare to work in Yaqeen.')):(descriptions[active?.path??'settings']??descriptions.settings)[ar?0:1];
  const tabHref=(section:string)=>{
    const query=new URLSearchParams(tabParams);
    if(section==='settings/system'){query.delete('organization');query.delete('fromSetup');}
    return `/${locale}/${section}?${query}`;
  };

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
        {sections.map((s) => (
          <Link
            key={s.path}
            href={tabHref(s.path)}
            aria-current={isSettingsSectionActive(path.split("/").slice(2).join("/"),s.path) ? "page" : undefined}
          >
            <SettingsIcon name={s.icon==='settings'?'system':s.icon==='payments'?'billing':s.icon}/><span>{ar ? s.ar : s.en}</span>
          </Link>
        ))}
      </nav>
      {children}
    </main>
  );
}
