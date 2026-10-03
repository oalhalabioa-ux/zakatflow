import FinancialEventOperationalPanel from '@/components/FinancialEventOperationalPanel';
import {assertFinancialBudgetQA} from '@/services/financial-budget';
import {notFound} from 'next/navigation';
import './financial-events.css';
export default async function FinancialEventsPage({params}:{params:Promise<{locale:string}>}){try{assertFinancialBudgetQA();}catch{notFound();}const{locale}=await params;return <FinancialEventOperationalPanel locale={locale}/>;}
