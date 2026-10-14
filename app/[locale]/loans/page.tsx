import LoansWorkspace from '@/components/LoansWorkspace';
import '../financial-register.css';
export default async function Page({params}:{params:Promise<{locale:string}>}){const {locale}=await params;return <LoansWorkspace locale={locale}/>;}
