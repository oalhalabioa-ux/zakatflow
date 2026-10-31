import SettingsFrame from "@/components/settings/SettingsFrame";
import OrganizationSettings from "@/components/settings/OrganizationSettings";
export default async function Settings({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return (
    <SettingsFrame locale={locale}>
      <OrganizationSettings locale={locale} />
    </SettingsFrame>
  );
}
