import {notFound} from 'next/navigation';
import FinancialReportsSuite from '@/components/financial-reports/FinancialReportsSuite';
export const dynamic='force-dynamic';
export const metadata={title:'Financial reporting design preview',robots:{index:false,follow:false}};
export default async function Page({searchParams}:{searchParams:Promise<{lang?:string}>}){
 if(process.env.FINANCIAL_REPORTS_DESIGN_PREVIEW!=='true'||process.env.VERCEL_ENV==='production')notFound();
 const query=await searchParams;
 return <FinancialReportsSuite initialEnglish={query.lang==='en'}/>;
}
