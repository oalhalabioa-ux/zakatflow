import FinancingScopeWorkspace from '@/components/FinancingScopeWorkspace';
import '../financial-register.css';
import '../debt-finance.css';
export default async function Page({params}:{params:Promise<{locale:string}>}){return <FinancingScopeWorkspace locale={(await params).locale} kind="ADVANCE"/>}
