import {notFound} from 'next/navigation';
import CorporateShell from '../../components/CorporateShell';
import {DisplayCurrencyProvider} from '../../components/DisplayCurrency';
import ThemeReview from '../../components/ThemeReview';
import YaqeenDashboard from '../../components/YaqeenDashboard';
import {yaqeenDashboardDemo} from '../../lib/yaqeen-dashboard-demo';
import '../yaqeen-dashboard.css';
import '../corporate.css';
import '../yaqeen-theme.css';
import '../[locale]/financial-register.css';
export const metadata={title:'Design review',robots:{index:false,follow:false}};
export default async function Page({searchParams}:{searchParams:Promise<{lang?:string;view?:string;w?:string;section?:string}>}){if(process.env.VERCEL_ENV==='production')notFound();const q=await searchParams;const locale=q.lang==='en'?'en':'ar';if(q.view==='responsive'){const width=[360,390,768,1024,1440].includes(Number(q.w))?Number(q.w):390;const section=['features','usecases','footer','sectors','solutions'].includes(q.section??'')?'#'+q.section:'';return <main style={{padding:12,background:'#e8edf4',minHeight:'100vh',textAlign:'center',overflow:'auto'}}><h1 style={{fontSize:16}}>Landing viewport · {width}px</h1><iframe title={`Landing preview ${width}px`} src={(locale==='ar'?'/':'/?lang=en')+section} width={width} height={900} style={{display:'block',margin:'12px auto',border:0,boxShadow:'0 0 0 4px #081f3b',borderRadius:10,background:'white'}}/></main>;}if(q.view==='mobile')return <main style={{padding:20,background:'#e8edf4',minHeight:'100vh',textAlign:'center'}}><h1 style={{fontSize:18}}>Mobile viewport · 390px</h1><iframe title="Mobile landing preview" src={locale==='ar'?'/':'/?lang=en'} width="390" height="844" style={{border:'6px solid #081f3b',borderRadius:18,maxWidth:'100%',background:'white'}}/></main>;return <DisplayCurrencyProvider locale={locale}><CorporateShell locale={locale}>{q.view==='dashboard'?<YaqeenDashboard model={yaqeenDashboardDemo} ar={locale==='ar'} locale={locale}/>:<ThemeReview ar={locale==='ar'}/>}</CorporateShell></DisplayCurrencyProvider>;}
