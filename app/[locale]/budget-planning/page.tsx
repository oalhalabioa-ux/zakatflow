import BudgetPlanningWorkspace from '@/components/BudgetPlanningWorkspace';
import './budget-planning.css';
export default async function BudgetPlanningPage({params}:{params:Promise<{locale:string}>}){const{locale}=await params;return <BudgetPlanningWorkspace locale={locale}/>}
