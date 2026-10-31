import SettingsFrame from "@/components/settings/SettingsFrame";
import BillingOrganizationPicker from "@/components/settings/BillingOrganizationPicker";
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
    <SettingsFrame locale={locale}>
      <BillingOrganizationPicker locale={locale} />
      <SubscriptionBanner locale={locale} always />
      <section className="subscription-panel">
        <h2 id="subscription-plans">{ar ? "خطط الاشتراك" : "Subscription plans"}</h2>
        <PricingCatalog locale={locale} />
      </section>
    </SettingsFrame>
  );
}
