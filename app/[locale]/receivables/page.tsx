import FinancialRegisterWorkspace from '@/components/FinancialRegisterWorkspace';
import '../financial-register.css';
import '../debt-finance.css';
export default async function Page({params,searchParams}:{params:Promise<{locale:string}>;searchParams:Promise<{scope?:string}>}){const [{locale},q]=await Promise.all([params,searchParams]);return <FinancialRegisterWorkspace locale={locale} view='debts' initialScope={q.scope==='ORGANIZATION'?'ORGANIZATION':'PERSONAL'}/>;}
