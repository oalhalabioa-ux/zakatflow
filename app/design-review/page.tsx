import {notFound} from 'next/navigation';
import CorporateShell from '../../components/CorporateShell';
import {DisplayCurrencyProvider} from '../../components/DisplayCurrency';
import ThemeReview from '../../components/ThemeReview';
import '../corporate.css';
import '../yaqeen-theme.css';
import '../[locale]/financial-register.css';
export const metadata={title:'Design review',robots:{index:false,follow:false}};
export default async function Page({searchParams}:{searchParams:Promise<{lang?:string;view?:string}>}){if(process.env.VERCEL_ENV==='production')notFound();const q=await searchParams;const locale=q.lang==='en'?'en':'ar';if(q.view==='mobile')return <main style={{padding:20,background:'#e8edf4',minHeight:'100vh',textAlign:'center'}}><h1 style={{fontSize:18}}>Mobile viewport · 390px</h1><iframe title="Mobile landing preview" src={locale==='ar'?'/':'/?lang=en'} width="390" height="844" style={{border:'6px solid #081f3b',borderRadius:18,maxWidth:'100%',background:'white'}}/></main>;return <DisplayCurrencyProvider locale={locale}><CorporateShell locale={locale}><ThemeReview ar={locale==='ar'}/></CorporateShell></DisplayCurrencyProvider>;}
