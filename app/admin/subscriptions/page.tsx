import { ownerLocale } from "@/lib/i18n/owner-server";
import { ownerTranslator } from "@/lib/i18n/owner";
import OwnerSidebar from "../OwnerSidebar";
import OwnerNavigation from "../OwnerNavigation";
import TrialAdmin from "@/components/subscriptions/TrialAdmin";
import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import "../owner.css";
export const dynamic = "force-dynamic";
export async function generateMetadata() {
  return {
    title: ownerTranslator(await ownerLocale())(
      "الاشتراكات والفترات التجريبية | يقين الأعمال",
    ),
  };
}
export default async function SubscriptionsPage() {
  const locale = await ownerLocale(),
    translate = ownerTranslator(locale);
  const db = await supabaseServer();
  const {
    data: { user },
    error,
  } = await db.auth.getUser();
  if (error || !user)
    redirect(
      `/${locale}/login?next=%2Fadmin%2Fsubscriptions%3Flang%3D${locale}`,
    );
  const { data: owner, error: roleError } = await db
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", user.id)
    .eq("role", "platform_owner")
    .maybeSingle();
  if (roleError || !owner)
    return (
      <main className="owner-denied" dir={locale === "ar" ? "rtl" : "ltr"}>
        <h1>{translate("الوصول غير مسموح")}</h1>
        <Link href="/">{translate("الرئيسية")}</Link>
      </main>
    );
  // TrialAdmin uses the same server-authorized register for metrics, plans and effective states.
  // Avoid retaining a second table that could show stale stored trial statuses.
  return (
    <main className="owner-shell" dir={locale === "ar" ? "rtl" : "ltr"}>
      <OwnerSidebar locale={locale} />
      <section className="owner-content">
        <OwnerNavigation locale={locale} />
        <header className="owner-top">
          <div>
            <h1>{translate("الاشتراكات والفترات التجريبية")}</h1>
            <p>
              {translate(
                "إدارة التجربة والاشتراك اليدوي متاحة لمالك المنصة. التحصيل المالي والدفع الإلكتروني غير مفعّلين.",
              )}
            </p>
          </div>
        </header>
        <TrialAdmin locale={locale} plans={[]} />
      </section>
    </main>
  );
}
