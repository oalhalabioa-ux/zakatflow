import BudgetPlanningWorkspace from '@/components/BudgetPlanningWorkspace';
import './budget-planning.css';
import {FINANCIAL_CORE_QA} from '@/services/financial-budget';
export default async function BudgetPlanningPage({params}:{params:Promise<{locale:string}>}){const{locale}=await params;return <BudgetPlanningWorkspace locale={locale} financialCoreQA={process.env.FINANCIAL_BUDGET_UI_QA==='true'&&process.env.NEXT_PUBLIC_SUPABASE_URL===`https://${FINANCIAL_CORE_QA}.supabase.co`}/>}
