import SettingsFrame from "@/components/settings/SettingsFrame";
import OrganizationDetailsWorkspace from "@/components/settings/OrganizationDetailsWorkspace";
export default async function Settings({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ organization?: string; fromSetup?:string;setupEmbed?:string }>;
}) {
  const [{ locale }, { organization }] = await Promise.all([params, searchParams]);
  return (
    <SettingsFrame locale={locale}>
      <OrganizationDetailsWorkspace locale={locale} preferredOrg={organization} />
    </SettingsFrame>
  );
}
