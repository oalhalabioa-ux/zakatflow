import LiquidityWorkspace from '@/components/LiquidityWorkspace';
import './liquidity.css';
export default async function LiquidityPage({params}:{params:Promise<{locale:string}>}){const{locale}=await params;return <LiquidityWorkspace locale={locale}/>}
