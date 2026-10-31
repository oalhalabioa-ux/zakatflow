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
    title: ownerTranslator(await ownerLocale())(
      "الإيرادات والمدفوعات | يقين الأعمال",
    ),
  };
}
export default async function PaymentsPage() {
  const locale = await ownerLocale();
  const translate = ownerTranslator(locale);
  const db = await supabaseServer();
  const {
    data: { user },
    error,
  } = await db.auth.getUser();
  if (error || !user)
    redirect(`/${locale}/login?next=%2Fadmin%2Fpayments%3Flang%3D${locale}`);
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
        <Link href={ownerHref("/admin", locale)}>
          {translate("لوحة المالك")}
        </Link>
      </main>
    );
  const { data: payments, error: paymentsError } = await db.rpc(
    "owner_list_payment_transactions",
    { p_limit: 100 },
  );
  const transactions = Array.isArray(payments) ? payments : [];
  return (
    <main className="owner-shell" dir={locale === "ar" ? "rtl" : "ltr"}>
      <OwnerSidebar locale={locale} />
      <section className="owner-content">
        <OwnerNavigation locale={locale} />
        <header className="owner-top">
          <div>
            <h1>{translate("الإيرادات والمدفوعات")}</h1>
            <p>{translate("إدارة مالية مستقلة خاصة بمالك المنصة")}</p>
          </div>
        </header>
        <div className="owner-intro">
          <h2>{translate("سجل معاملات مزود الدفع")}</h2>
          <p>
            {translate(
              "سجل للقراءة فقط. لا تُعرض أية إيرادات ما لم تُسجّل معاملات موثوقة عبر تكامل دفع معتمد.",
            )}
          </p>
          {paymentsError ? (
            <p role="alert">
              {translate(
                "تعذر تحميل سجل المعاملات. تحقق من صلاحيات المالك واتصال المنصة.",
              )}
            </p>
          ) : transactions.length === 0 ? (
            <p>
              {translate("لا توجد معاملات مسجلة. التحصيل المالي غير مفعّل.")}
            </p>
          ) : (
            <div className="owner-table-wrap">
              <table className="owner-users-table">
                <thead>
                  <tr>
                    <th>{translate("الشركة")}</th>
                    <th>{translate("مزود الدفع")}</th>
                    <th>{translate("نوع العملية")}</th>
                    <th>{translate("الحالة")}</th>
                    <th>{translate("المبلغ")}</th>
                    <th>{translate("التاريخ")}</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map(
                    (t: {
                      id: string;
                      organization_name: string;
                      provider: string;
                      event_kind: string;
                      status: string;
                      amount: number;
                      currency: string;
                      occurred_at: string;
                    }) => (
                      <tr key={t.id}>
                        <td data-label={translate("الشركة")}>
                          {t.organization_name}
                        </td>
                        <td data-label={translate("مزود الدفع")}>
                          {t.provider}
                        </td>
                        <td data-label={translate("نوع العملية")}>
                          {t.event_kind === "refund"
                            ? translate("استرداد")
                            : translate("دفع")}
                        </td>
                        <td data-label={translate("الحالة")}>{t.status}</td>
                        <td data-label={translate("المبلغ")}>
                          {Number(t.amount).toLocaleString(
                            locale === "ar"
                              ? "ar-SA-u-ca-gregory-nu-latn"
                              : "en-GB",
                            {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            },
                          )}{" "}
                          {t.currency}
                        </td>
                        <td data-label={translate("التاريخ")}>
                          {new Date(t.occurred_at).toLocaleDateString(
                            locale === "ar"
                              ? "ar-SA-u-ca-gregory-nu-latn"
                              : "en-GB",
                          )}
                        </td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="owner-intro">
          <h2>{translate("تجهيز سجل التحصيل")}</h2>
          <p>
            {translate(
              "لم يتم ربط بوابة دفع أو مصدر موثوق لعمليات التحصيل بعد. لا توجد مبالغ مالية مؤكدة يمكن عرضها في هذه البيئة.",
            )}
          </p>
          <p>
            {translate(
              "سيشمل القسم بعد الربط: الفواتير، المدفوعات الناجحة والمرفوضة، المبالغ المستردة، وتسوية الاشتراكات.",
            )}
          </p>
          <Link href={ownerHref("/admin/subscriptions", locale)}>
            {translate("عرض الاشتراكات")}
          </Link>
        </div>
      </section>
    </main>
  );
}
