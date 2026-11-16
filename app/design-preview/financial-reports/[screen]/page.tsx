import {notFound} from 'next/navigation';
import FinancialReportsSuite from '@/components/financial-reports/FinancialReportsSuite';
import {FINANCIAL_SCREENS,type FinancialScreen} from '@/lib/financial-reporting-demo';
export const dynamic='force-dynamic';
export const metadata={title:'Financial reporting design preview',robots:{index:false,follow:false}};
export default async function Page({params,searchParams}:{params:Promise<{screen:string}>;searchParams:Promise<{lang?:string}>}){
 if(process.env.FINANCIAL_REPORTS_DESIGN_PREVIEW!=='true'||process.env.VERCEL_ENV==='production')notFound();
 const {screen}=await params,query=await searchParams;
 if(!FINANCIAL_SCREENS.some(s=>s[0]===screen))notFound();
 return <FinancialReportsSuite initialScreen={screen as FinancialScreen} initialEnglish={query.lang==='en'}/>;
}
