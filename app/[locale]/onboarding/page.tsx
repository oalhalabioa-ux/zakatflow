import { redirect } from "next/navigation";
import { requireUser } from "@/services/auth";
import OrganizationOnboarding from "@/components/subscriptions/OrganizationOnboarding";
export default async function Onboarding({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const { user } = await requireUser();
  if (!user.email_confirmed_at) redirect(`/${locale}/login`);
  return <OrganizationOnboarding locale={locale} />;
}
