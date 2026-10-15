import DebtCollectionWorkspace from '@/components/DebtCollectionWorkspace';
import '../financial-register.css';
import '../debt-finance.css';
export default async function Page({params}:{params:Promise<{locale:string}>}){return <DebtCollectionWorkspace locale={(await params).locale}/>}
