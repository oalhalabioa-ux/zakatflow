import LiquidityWorkspace from '@/components/LiquidityWorkspace';
import SetupReturnLink from '@/components/settings/SetupReturnLink';
import './liquidity.css';
import '../financial-register.css';
const tabs=['overview','position','calendar','forecast','scenarios','transfers','counterparties'] as const;
type Tab=(typeof tabs)[number];
export default async function LiquidityPage({params,searchParams}:{params:Promise<{locale:string}>;searchParams:Promise<{tab?:string;organization?:string;fromSetup?:string}>}){const[{locale},{tab,organization,fromSetup}]=await Promise.all([params,searchParams]);const initialTab=tabs.includes(tab as Tab)?tab as Tab:'overview';return <><SetupReturnLink locale={locale} organization={organization} visible={fromSetup==='1'}/><LiquidityWorkspace locale={locale} initialTab={initialTab}/></>}
