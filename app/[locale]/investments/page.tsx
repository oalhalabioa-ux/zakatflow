import './instrument.css';
import '../financial-register.css';
import '../debt-finance.css';
import InvestmentWorkspace from '@/components/InvestmentsHome';
export default async function Page({params}:{params:Promise<{locale:string}>}){const {locale}=await params;return <InvestmentWorkspace locale={locale}/>;}
