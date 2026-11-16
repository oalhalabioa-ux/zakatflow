import { ownerLocale } from "@/lib/i18n/owner-server";
import { ownerTranslator, ownerHref } from "@/lib/i18n/owner";
import OwnerMetrics from "./OwnerMetrics";
import { adminCount } from "@/lib/admin/metrics";
import Link from "next/link";
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
      supabase.rpc("owner_subscription_panel", { p_organization_id: null }),
    ]);
  const totalUsers = usersResult.error ? null : adminCount(usersResult.data);
  const totalOrganizations = organizationsResult.error
    ? null
    : adminCount(organizationsResult.data);
  const panel = subscriptionsResult.error ? null : subscriptionsResult.data;
  const activeSubscriptions = adminCount(panel?.active);
  const ar = locale === "ar";
  const t = (a: string, e: string) => (ar ? a : e);
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
        <OwnerMetrics
          locale={locale}
          items={[
            {
              label: translate("المستخدمون"),
              value: totalUsers,
              icon: "users",
              note: t("الحسابات المسجلة", "Registered accounts"),
            },
            {
              label: translate("الشركات"),
              value: totalOrganizations,
              icon: "building",
              note: t("جميع المؤسسات", "All organizations"),
            },
            {
              label: t("التجارب النشطة", "Active trials"),
              value: adminCount(panel?.trialing),
              icon: "trial",
              note: t("الفترة التجريبية سارية", "Trials in progress"),
            },
            {
              label: translate("الاشتراكات النشطة"),
              value: activeSubscriptions,
              icon: "card",
              tone: "success",
              note: t("حسب الحالة الحالية", "Based on current status"),
            },
          ]}
        />
        <div className="owner-intro">
          <h2>{translate("مراحل التفعيل")}</h2>
          <p>
            {translate(
              "تعرض المؤشرات بيانات المنصة الفعلية. إدارة الاشتراكات متاحة لمالك المنصة، والتحصيل المالي ما زال معطلاً.",
            )}
          </p>
        </div>
        <div className="owner-analytics-grid">
          <article className="owner-analysis-card">
            <h2>{t("متابعة الاشتراكات", "Subscription operations")}</h2>
            <p>
              {t(
                "راجع المؤسسات وطلبات التفعيل وسجل التغييرات من مركز الاشتراكات.",
                "Review organizations, activation requests and the audit trail in the subscription center.",
              )}
            </p>
            <Link
              className="owner-action primary"
              href={ownerHref("/admin/subscriptions", locale)}
            >
              {t("إدارة الاشتراكات", "Manage subscriptions")}
            </Link>
          </article>
          <article className="owner-analysis-card">
            <h2>{t("تحليلات المنصة", "Platform analytics")}</h2>
            <p>
              {t(
                "توزيع حالات المؤسسات والتجارب القريبة من الانتهاء ومؤشرات المتابعة.",
                "Organization states, trials approaching expiry and operational follow-up metrics.",
              )}
            </p>
            <Link
              className="owner-action"
              href={ownerHref("/admin/analytics", locale)}
            >
              {t("عرض التحليلات", "View analytics")}
            </Link>
          </article>
        </div>
      </section>
    </main>
  );
}
