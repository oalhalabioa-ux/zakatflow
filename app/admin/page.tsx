import { ownerLocale } from "@/lib/i18n/owner-server";
import { ownerTranslator, ownerHref } from "@/lib/i18n/owner";
import OwnerSidebar from "./OwnerSidebar";
import OwnerNavigation from "./OwnerNavigation";
import { redirect } from "next/navigation";
import { supabaseServer } from "../../lib/supabase/server";
import "./owner.css";

export const dynamic = "force-dynamic";
export async function generateMetadata() {
  return { title: ownerTranslator(await ownerLocale())("لوحة مالك المنصة") };
}

export default async function OwnerDashboard() {
  const locale = await ownerLocale();
  const translate = ownerTranslator(locale);
  const supabase = await supabaseServer();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user)
    redirect(`/${locale}/login?next=%2Fadmin%3Flang%3D${locale}`);
  // Only a server-verified application role can unlock platform-wide data.
  // User-controlled metadata and email address are never authorization sources.
  const { data: owner, error: roleError } = await supabase
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", user.id)
    .eq("role", "platform_owner")
    .maybeSingle();
  if (roleError || !owner)
    return (
      <main className="owner-denied" dir={locale === "ar" ? "rtl" : "ltr"}>
        <h1>{translate("الوصول غير مسموح")}</h1>
        <p>{translate("هذه الصفحة مخصصة لمالك منصة يقين الأعمال.")}</p>
        <a href="/">{translate("العودة إلى الرئيسية")}</a>
      </main>
    );

  const [usersResult, organizationsResult, subscriptionsResult] =
    await Promise.all([
      supabase.rpc("owner_user_count"),
      supabase.rpc("owner_organization_count"),
      supabase.rpc("owner_subscription_summary"),
    ]);
  const totalUsers = usersResult.error ? null : Number(usersResult.data);
  const totalOrganizations = organizationsResult.error
    ? null
    : Number(organizationsResult.data);
  const { data: subscriptionRows, error: subscriptionError } =
    subscriptionsResult;
  const subscriptionSummary = Array.isArray(subscriptionRows)
    ? subscriptionRows[0]
    : null;
  const activeSubscriptions =
    subscriptionError || !subscriptionSummary
      ? null
      : Number(subscriptionSummary.active_subscriptions);
  return (
    <main className="owner-shell" dir={locale === "ar" ? "rtl" : "ltr"}>
      <OwnerSidebar locale={locale} />
      <section className="owner-content">
        <OwnerNavigation locale={locale} />
        <header className="owner-top">
          <div>
            <h1>{translate("لوحة تحكم مالك المنصة")}</h1>
            <p>{translate("إدارة يقين الأعمال ومتابعة أدائها")}</p>
          </div>
        </header>
        <div className="owner-intro">
          <h2>{translate("مرحباً بك في يقين الأعمال")}</h2>
          <p>
            {translate(
              "لوحة إدارة مستقلة بصلاحيات محمية، متوافقة مع الثيمات المعتمدة.",
            )}
          </p>
        </div>
        <div className="owner-kpis">
          {[
            [
              translate("المستخدمون"),
              totalUsers === null ? "—" : String(totalUsers),
            ],
            [
              translate("الشركات"),
              totalOrganizations === null ? "—" : String(totalOrganizations),
            ],
            [translate("الإيرادات الشهرية"), "—"],
            [
              translate("الاشتراكات النشطة"),
              activeSubscriptions === null ? "—" : String(activeSubscriptions),
            ],
          ].map(([label, value]) => (
            <article key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
              <small>
                {label === translate("المستخدمون") ||
                label === translate("الشركات") ||
                label === translate("الاشتراكات النشطة")
                  ? translate("بيانات المنصة الحالية")
                  : translate("لم يتم ربط مصدر البيانات بعد")}
              </small>
            </article>
          ))}
        </div>
        <div className="owner-intro">
          <h2>{translate("مراحل التفعيل")}</h2>
          <p>
            {translate(
              "تعرض المؤشرات بيانات المنصة الفعلية. إدارة الاشتراكات متاحة لمالك المنصة، والتحصيل المالي ما زال معطلاً.",
            )}
          </p>
        </div>
        <div className="owner-panels">
          <article>
            <h3>{translate("نمو المستخدمين والإيرادات")}</h3>
            <p>
              {translate(
                "سيتم عرض المؤشرات الفعلية بعد إتاحة واجهة التقارير الإدارية المحمية.",
              )}
            </p>
            <div className="owner-placeholder">
              {translate("لا توجد بيانات معروضة حالياً")}
            </div>
          </article>
          <article>
            <h3>{translate("التحليلات المتقدمة")}</h3>
            <p>
              {translate(
                "الاحتفاظ، توزيع الباقات، النشاط الشهري، وتحليل النمو.",
              )}
            </p>
            <div className="owner-placeholder">{translate("قيد الربط")}</div>
          </article>
        </div>
      </section>
    </main>
  );
}
