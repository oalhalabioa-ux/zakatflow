import {notFound} from 'next/navigation';
import {assertLiveStatements} from '../../../services/financial-statement-live';
import {requireUser} from '../../../services/auth';
import FinancialStatementSource from '../../../components/financial-reports/FinancialStatementSource';
import {STATEMENT_HUB_TITLES,type StatementHubView} from '../../../lib/financial-statement-summary';
export const dynamic='force-dynamic';
export default async function FinancialReportsPage({params,searchParams}:{params:Promise<{locale:string}>;searchParams:Promise<{screen?:string;organization?:string}>}){try{assertLiveStatements()}catch{notFound()}await requireUser();const[{locale},q]=await Promise.all([params,searchParams]);return <FinancialStatementSource live key={q.organization} preferredOrg={q.organization} initialEnglish={locale==='en'} initialView={q.screen&&Object.hasOwn(STATEMENT_HUB_TITLES,q.screen)?q.screen as StatementHubView:'overview'}/>}
