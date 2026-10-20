import LoansWorkspace from '@/components/LoansWorkspace';
import '../financial-register.css';
import '../debt-finance.css';
export default async function Page({params}:{params:Promise<{locale:string}>}){return <LoansWorkspace locale={(await params).locale} productMode="QARD"/>}
