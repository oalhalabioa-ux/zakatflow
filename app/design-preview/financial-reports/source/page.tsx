import {notFound} from 'next/navigation';
import {assertFinancialReportingSourceQA} from '@/services/financial-reporting-source';
import FinancialReportingSource from '@/components/financial-reports/FinancialReportingSource';
export const dynamic='force-dynamic';
export const metadata={title:'Financial source read QA',robots:{index:false,follow:false}};
export default async function Page({searchParams}:{searchParams:Promise<{lang?:string}>}){try{assertFinancialReportingSourceQA()}catch{notFound()}const q=await searchParams;return <FinancialReportingSource initialEnglish={q.lang==='en'}/>}
