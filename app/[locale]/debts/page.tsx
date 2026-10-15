import DebtFinanceOverview from '@/components/DebtFinanceOverview';
import '../financial-register.css';
import '../debt-finance.css';
export default async function Page({params,searchParams}:{params:Promise<{locale:string}>;searchParams:Promise<{scope?:string}>}){const [{locale},q]=await Promise.all([params,searchParams]);return <DebtFinanceOverview locale={locale} initialScope={q.scope==='ORGANIZATION'?'ORGANIZATION':'PERSONAL'}/>}
