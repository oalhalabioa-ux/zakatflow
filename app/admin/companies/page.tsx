import OwnerMetrics from "../OwnerMetrics";
import { ownerLocale } from "@/lib/i18n/owner-server";
import { ownerTranslator, ownerHref } from "@/lib/i18n/owner";
import OwnerSidebar from "../OwnerSidebar";
import OwnerNavigation from "../OwnerNavigation";
import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "../../../lib/supabase/server";
import "../owner.css";
export const dynamic = "force-dynamic";
export async function generateMetadata() {
  return {
    title: ownerTranslator(await ownerLocale())("إدارة الشركات | يقين الأعمال"),
  };
}
type Organization = {
  id: string;
  name: string;
  legal_name: string | null;
  base_currency: string;
  entity_type: string;
  status: string;
  created_at: string;
  owner_email: string | null;
  member_count: number;
};
export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const locale = await ownerLocale();
  const translate = ownerTranslator(locale);
  const db = await supabaseServer();
  const {
    data: { user },
    error,
  } = await db.auth.getUser();
  if (error || !user)
    redirect(`/${locale}/login?next=%2Fadmin%2Fcompanies%3Flang%3D${locale}`);
  const { data: membership } = await db
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", user.id)
    .eq("role", "platform_owner")
    .maybeSingle();
  if (!membership)
    return (
      <main className="owner-denied" dir={locale === "ar" ? "rtl" : "ltr"}>
        <h1>{translate("الوصول غير مسموح")}</h1>
        <Link href="/">{translate("الرئيسية")}</Link>
      </main>
    );
  const requested = Number((await searchParams).page || 1);
  const page = Number.isSafeInteger(requested)
    ? Math.max(1, Math.min(requested, 10000))
    : 1;
  const { data, error: loadError } = await db.rpc("owner_list_organizations", {
    p_page: page,
    p_per_page: 30,
  });
  const organizations = (data || []) as Organization[];
  const date = (value: string) =>
    new Date(value).toLocaleDateString(
      locale === "ar" ? "ar-SA-u-ca-gregory-nu-latn" : "en-GB",
      { year: "numeric", month: "short", day: "numeric" },
    );
  return (
    <main className="owner-shell" dir={locale === "ar" ? "rtl" : "ltr"}>
      <OwnerSidebar locale={locale} />
      <section className="owner-content">
        <OwnerNavigation locale={locale} />
        <header className="owner-top">
          <div>
            <Link href={ownerHref("/admin", locale)}>
              {translate("← لوحة المالك")}
            </Link>
            <h1>{translate("إدارة الشركات")}</h1>
            <p>{translate("سجل المؤسسات الفعلي — عرض فقط")}</p>
          </div>
        </header>
        <OwnerMetrics
          locale={locale}
          items={[
            {
              label:
                locale === "ar"
                  ? "المؤسسات المعروضة"
                  : "Displayed organizations",
              value: loadError ? null : organizations.length,
              icon: "building",
              note:
                locale === "ar"
                  ? "ضمن الصفحة الحالية، حتى 30 مؤسسة"
                  : "Current page, up to 30 organizations",
            },
            {
              label:
                locale === "ar" ? "الأعضاء المسجلون" : "Registered memberships",
              value: loadError
                ? null
                : organizations.reduce(
                    (sum, org) => sum + Number(org.member_count || 0),
                    0,
                  ),
              icon: "users",
              note:
                locale === "ar"
                  ? "مجموع عضويات المؤسسات المعروضة"
                  : "Memberships of displayed organizations",
            },
            {
              label:
                locale === "ar" ? "عملات المؤسسات" : "Organization currencies",
              value: loadError
                ? null
                : new Set(organizations.map((org) => org.base_currency)).size,
              icon: "layers",
              note:
                locale === "ar"
                  ? "ضمن الصفحة الحالية"
                  : "Within the current page",
            },
          ]}
        />
        <div className="owner-intro">
          <h2>{translate("الشركات المسجلة")}</h2>
          <p>{translate("تظهر هنا المؤسسات المسجلة فعلياً في المنصة.")}</p>
        </div>
        {loadError ? (
          <p role="alert">
            {translate(
              "تعذر تحميل سجل الشركات. يرجى التحقق من الصلاحيات والاتصال.",
            )}
          </p>
        ) : (
          <div className="owner-table-wrap">
            <table className="owner-users-table">
              <thead>
                <tr>
                  <th>{translate("الشركة")}</th>
                  <th>{translate("المالك")}</th>
                  <th>{translate("النوع")}</th>
                  <th>{translate("العملة")}</th>
                  <th>{translate("الحالة")}</th>
                  <th>{translate("الأعضاء")}</th>
                  <th>{translate("تاريخ التسجيل")}</th>
                </tr>
              </thead>
              <tbody>
                {organizations.map((org) => (
                  <tr key={org.id}>
                    <td data-label={translate("الشركة")}>
                      <strong>{org.name}</strong>
                      {org.legal_name && org.legal_name !== org.name ? (
                        <div>{org.legal_name}</div>
                      ) : null}
                    </td>
                    <td data-label={translate("المالك")} dir="ltr">
                      {org.owner_email || "—"}
                    </td>
                    <td data-label={translate("النوع")}>{org.entity_type}</td>
                    <td data-label={translate("العملة")}>
                      {org.base_currency}
                    </td>
                    <td data-label={translate("الحالة")}>{org.status}</td>
                    <td data-label={translate("الأعضاء")}>
                      {org.member_count}
                    </td>
                    <td data-label={translate("تاريخ التسجيل")}>
                      {date(org.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {organizations.length === 0 && (
              <p>{translate("لا توجد مؤسسات مسجلة حتى الآن.")}</p>
            )}
          </div>
        )}
        <nav className="owner-pagination">
          {page > 1 && (
            <Link href={ownerHref(`/admin/companies?page=${page - 1}`, locale)}>
              {translate("السابق")}
            </Link>
          )}
          {organizations.length === 30 && (
            <Link href={ownerHref(`/admin/companies?page=${page + 1}`, locale)}>
              {translate("التالي")}
            </Link>
          )}
        </nav>
      </section>
    </main>
  );
}
