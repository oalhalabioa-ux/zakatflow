import {notFound} from 'next/navigation';
import FinancialReportsPilot from '@/components/financial-reports/FinancialReportsPilot';
export const dynamic='force-dynamic';
export const metadata={title:'Financial reporting design preview',robots:{index:false,follow:false}};
export default async function Page({searchParams}:{searchParams:Promise<{lang?:string}>}){
 // Explicit local opt-in. This route cannot be enabled on a Vercel Production deployment.
 if(process.env.FINANCIAL_REPORTS_DESIGN_PREVIEW!=='true'||process.env.VERCEL_ENV==='production')notFound();
 const query=await searchParams;
 return <FinancialReportsPilot initialEnglish={query.lang==='en'}/>;
}
