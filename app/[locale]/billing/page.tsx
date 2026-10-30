import SubscriptionBanner from "@/components/subscriptions/SubscriptionBanner";
import Link from "next/link";
export default async function Billing({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params,
    ar = locale === "ar";
  return (
    <main dir={ar ? "rtl" : "ltr"}>
      <SubscriptionBanner locale={locale} always />
      <section className="subscription-panel">
        <h1>{ar ? "خطط الاشتراك" : "Subscription plans"}</h1>
        <p>
          {ar
            ? "التجربة المجانية تشمل 30 يوماً و5 مستخدمين وجميع الموديولات الأساسية."
            : "The free trial includes 30 days, 5 users and all core modules."}
        </p>
        <p>
          {ar
            ? "الاشتراكات المدفوعة قيد التجهيز. لا يُطلب إدخال بطاقة ولا ينفذ أي خصم أو تجديد تلقائي. بياناتك تبقى محفوظة بعد انتهاء التجربة."
            : "Paid subscriptions are being prepared. No card is required and no automatic charge or renewal occurs. Your data is preserved after the trial."}
        </p>
        <Link href={`/${locale}/guide`}>
          {ar ? "المساعدة والتواصل مع الدعم" : "Help and support"}
        </Link>
      </section>
    </main>
  );
}
