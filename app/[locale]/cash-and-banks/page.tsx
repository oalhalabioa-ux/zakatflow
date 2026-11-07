import FinancialRegisterWorkspace from '@/components/FinancialRegisterWorkspace';
import SetupReturnLink from '@/components/settings/SetupReturnLink';
import '../financial-register.css';
export default async function Page({params,searchParams}:{params:Promise<{locale:string}>;searchParams:Promise<{scope?:string;organization?:string;fromSetup?:string}>}){const [{locale},q]=await Promise.all([params,searchParams]);return <><SetupReturnLink locale={locale} organization={q.organization} visible={q.fromSetup==='1'}/><FinancialRegisterWorkspace locale={locale} view='cash' initialScope={q.scope==='ORGANIZATION'?'ORGANIZATION':'PERSONAL'}/></>;}
