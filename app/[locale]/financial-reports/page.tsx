import {notFound} from 'next/navigation';
import {assertLiveStatements} from '../../../services/financial-statement-live';
import {requireUser} from '../../../services/auth';
import FinancialStatementSource from '../../../components/financial-reports/FinancialStatementSource';
export const dynamic='force-dynamic';
export default async function FinancialReportsPage({params}:{params:Promise<{locale:string}>}){try{assertLiveStatements()}catch{notFound()}await requireUser();const{locale}=await params;return <FinancialStatementSource live initialEnglish={locale==='en'} initialView="overview"/>}
