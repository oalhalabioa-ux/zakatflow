import LiquidityWorkspace from '@/components/LiquidityWorkspace';
import './liquidity.css';
const tabs=['overview','position','calendar','forecast','scenarios'] as const;
type Tab=(typeof tabs)[number];
export default async function LiquidityPage({params,searchParams}:{params:Promise<{locale:string}>;searchParams:Promise<{tab?:string}>}){const[{locale},{tab}]=await Promise.all([params,searchParams]);const initialTab=tabs.includes(tab as Tab)?tab as Tab:'overview';return <LiquidityWorkspace locale={locale} initialTab={initialTab}/>}
