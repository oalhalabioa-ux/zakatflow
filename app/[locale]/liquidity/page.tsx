import LiquidityWorkspace from '@/components/LiquidityWorkspace';
import FinancialRegisterWorkspace from '@/components/FinancialRegisterWorkspace';
import SetupReturnLink from '@/components/settings/SetupReturnLink';
import './liquidity.css';
import '../financial-register.css';

const tabs = ['overview', 'position', 'calendar', 'forecast', 'scenarios', 'transfers', 'counterparties'] as const;
type Tab = (typeof tabs)[number];
type Query = {tab?: string; scope?: string; organization?: string; fromSetup?: string; setupEmbed?: string};

export default async function LiquidityPage({params, searchParams}: {
  params: Promise<{locale: string}>;
  searchParams: Promise<Query>;
}) {
  const [{locale}, query] = await Promise.all([params, searchParams]);
  const tab = tabs.includes(query.tab as Tab) ? query.tab as Tab : 'overview';
  const ar = locale === 'ar';
  if (query.scope === 'PERSONAL') {
    if (tab === 'calendar' || tab === 'forecast' || tab === 'scenarios') {
      const labels = {calendar: ['التقويم النقدي', 'Cash calendar'], forecast: ['توقعات السيولة', 'Cash forecast'], scenarios: ['سيناريوهات السيولة', 'Cash scenarios']};
      return <main className="container"><section className="card" role="status">
        <h1>{labels[tab][ar ? 0 : 1]}</h1>
        <p>{ar ? 'هذا القسم متاح في النطاق المؤسسي. لعرضه اختر «مؤسسي» من البانر.' : 'This section is available for organizations. Select Business in the banner to open it.'}</p>
      </section></main>;
    }
    return <FinancialRegisterWorkspace key={tab} locale={locale} initialScope="PERSONAL" view={tab === 'counterparties' ? 'debt-report' : 'cash'}/>;
  }
  if (query.scope !== 'ORGANIZATION') {
    return <p role="status">{ar ? 'جارٍ تحديد نطاق العمل…' : 'Loading workspace scope…'}</p>;
  }
  return <>
    <SetupReturnLink locale={locale} organization={query.organization} visible={query.fromSetup === '1'} embedded={query.setupEmbed === '1'}/>
    <LiquidityWorkspace locale={locale} initialTab={tab}/>
  </>;
}
