import {notFound} from 'next/navigation';
import OpeningBalancesPreview from '@/components/financial-reports/OpeningBalancesPreview';
export const dynamic='force-dynamic';
export const metadata={title:'Opening balances design preview',robots:{index:false,follow:false}};
export default async function Page({searchParams}:{searchParams:Promise<{lang?:string}>}){
 if(process.env.FINANCIAL_REPORTS_DESIGN_PREVIEW!=='true'||process.env.VERCEL_ENV==='production')notFound();
 const q=await searchParams;return <OpeningBalancesPreview initialEnglish={q.lang==='en'}/>;
}
