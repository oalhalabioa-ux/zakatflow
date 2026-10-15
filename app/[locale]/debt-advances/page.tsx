import DebtAdvancesWorkspace from '@/components/DebtAdvancesWorkspace';
import '../financial-register.css';
import '../debt-finance.css';
export default async function Page({params}:{params:Promise<{locale:string}>}){return <DebtAdvancesWorkspace locale={(await params).locale}/>}
