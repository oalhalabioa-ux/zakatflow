import Link from 'next/link';
import {getDashboard} from '@/services/dashboard';
import CustomDashboard from '@/components/CustomDashboard';
import './dashboard.css';
export default async function Dashboard({params,searchParams}:{params:Promise<{locale:string}>,searchParams:Promise<{currency?:string}>}){const{locale}=await params,q=await searchParams,currency=q.currency==='USD'?'USD':'SAR';let d:any=null;try{d=await getDashboard()}catch{}d=d||{};return <><div className="container" style={{paddingBottom:0}}><div className="pro-currency"><Link className={currency==='SAR'?'active':''} href={`/${locale}/dashboard`}>SAR</Link><Link className={currency==='USD'?'active':''} href={`/${locale}/dashboard?currency=USD`}>USD</Link></div></div><CustomDashboard d={d} locale={locale} currency={currency}/></>}
