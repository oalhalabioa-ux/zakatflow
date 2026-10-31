import SubscriptionBanner from "@/components/subscriptions/SubscriptionBanner";
import PricingCatalog from "@/components/subscriptions/PricingCatalog";
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
        <PricingCatalog locale={locale} />
      </section>
    </main>
  );
}
