import FinancialRegisterWorkspace from '@/components/FinancialRegisterWorkspace';
import '../financial-register.css';
export default async function Page({params,searchParams}:{params:Promise<{locale:string}>;searchParams:Promise<{scope?:string}>}){const [{locale},q]=await Promise.all([params,searchParams]);return <FinancialRegisterWorkspace locale={locale} view='debts' initialDebtSide='PAYABLE' initialScope={q.scope==='PERSONAL'?'PERSONAL':'ORGANIZATION'}/>;}
