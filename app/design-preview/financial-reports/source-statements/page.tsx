import {notFound} from 'next/navigation';
import {assertLocalStatementSource} from '@/services/financial-statement-source';
import FinancialStatementSource from '@/components/financial-reports/FinancialStatementSource';
export const dynamic='force-dynamic';
export const metadata={title:'Local canonical statement acceptance',robots:{index:false,follow:false}};
export default async function Page({searchParams}:{searchParams:Promise<{lang?:string;screen?:string}>}){try{assertLocalStatementSource()}catch{notFound()}const q=await searchParams;return <FinancialStatementSource initialEnglish={q.lang==='en'} initialView={q.screen==='position'?'position':q.screen==='cash-flow'?'cash-flow':'income'}/>}
