import './instrument.css';
import InvestmentWorkspace from '@/components/InvestmentWorkspace';
export default async function Page({params}:{params:Promise<{locale:string}>}){const {locale}=await params;return <InvestmentWorkspace locale={locale}/>;}
