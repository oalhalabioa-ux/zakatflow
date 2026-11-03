import {notFound} from 'next/navigation';
import {assertLocalStatementSource} from '@/services/financial-statement-source';
import {STATEMENT_HUB_TITLES,type StatementHubView} from '@/lib/financial-statement-summary';
import FinancialStatementSource from '@/components/financial-reports/FinancialStatementSource';
export const dynamic='force-dynamic';
export const metadata={title:'Local canonical statement acceptance',robots:{index:false,follow:false}};
export default async function Page({searchParams}:{searchParams:Promise<{lang?:string;screen?:string}>}){try{assertLocalStatementSource()}catch{notFound()}const q=await searchParams;return <FinancialStatementSource initialEnglish={q.lang==='en'} initialView={q.screen&&Object.hasOwn(STATEMENT_HUB_TITLES,q.screen)?q.screen as StatementHubView:'income'}/>}
