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
export default async function Page({searchParams}:{searchParams:Promise<{lang?:string;view?:string;w?:string;h?:string;section?:string;page?:string}>}){if(process.env.VERCEL_ENV==='production')notFound();const q=await searchParams;const locale=q.lang==='en'?'en':'ar';if(q.view==='owner'){
 const width=[360,390,600,768,850,1024,1440].includes(Number(q.w))?Number(q.w):390;
 const pages=[['','الرئيسية'],['users','المستخدمون'],['companies','الشركات'],['subscriptions','الاشتراكات'],['payments','المدفوعات'],['analytics','التحليلات'],['settings','الإعدادات']] as const;
 const page=pages.some(([key])=>key===q.page)?q.page||'':'';
 const reviewUrl=(w:number,p:string)=>`/design-review?view=owner&w=${w}&page=${p}`;
 return <main dir="rtl" style={{padding:16,background:'#e8edf4',color:'#14283e',minHeight:'100vh',overflowX:'auto'}}>
  <h1 style={{fontSize:18,margin:'0 0 8px'}}>معاينة مقاسات لوحة المالك · {width} بكسل</h1>
  <p style={{margin:'0 0 12px',fontSize:13}}>تعرض اللوحة الحقيقية داخل إطار بالمقاس المحدد. تبقى صلاحيات المالك وتسجيل الدخول مطلوبة.</p>
  <nav aria-label="مقاسات المعاينة" style={{display:'flex',gap:8,flexWrap:'wrap'}}>{[360,390,600,768,850,1024,1440].map(w=><a key={w} href={reviewUrl(w,page)} aria-current={width===w?'page':undefined} style={{padding:'5px 10px',borderRadius:7,background:width===w?'#14283e':'white',color:width===w?'white':'#14283e'}}>{w}px</a>)}</nav>
  <iframe title="معاينة لوحة مالك المنصة" src={page?`/admin/${page}`:'/admin'} width={width} height={900} style={{display:'block',width,height:900,border:0,boxShadow:'0 0 0 1px #a4b3c4',margin:'18px auto',background:'#091626'}}/>
 </main>;
}if(q.view==='signin'){const width=[360,390,768,1024,1440].includes(Number(q.w))?Number(q.w):390;const height=[640,667,740,768,844,900].includes(Number(q.h))?Number(q.h):844;return <main style={{padding:12,background:'#e8edf4',minHeight:'100vh',textAlign:'center'}}><h1 style={{fontSize:16}}>Sign-in viewport · {width} × {height}</h1><iframe title="Sign-in viewport" src={`/${locale}/login`} width={width} height={height} style={{display:'block',margin:'12px auto',border:0,background:'#071c30'}}/></main>;}if(q.view==='responsive'){const width=[360,390,768,1024,1440].includes(Number(q.w))?Number(q.w):390;const section=['features','usecases','footer','sectors','solutions'].includes(q.section??'')?'#'+q.section:'';return <main style={{padding:12,background:'#e8edf4',minHeight:'100vh',textAlign:'center',overflow:'auto'}}><h1 style={{fontSize:16}}>Landing viewport · {width}px</h1><iframe title={`Landing preview ${width}px`} src={(locale==='ar'?'/':'/?lang=en')+section} width={width} height={900} style={{display:'block',margin:'12px auto',border:0,boxShadow:'0 0 0 4px #081f3b',borderRadius:10,background:'white'}}/></main>;}if(q.view==='mobile')return <main style={{padding:20,background:'#e8edf4',minHeight:'100vh',textAlign:'center'}}><h1 style={{fontSize:18}}>Mobile viewport · 390px</h1><iframe title="Mobile landing preview" src={locale==='ar'?'/':'/?lang=en'} width="390" height="844" style={{border:'6px solid #081f3b',borderRadius:18,maxWidth:'100%',background:'white'}}/></main>;return <DisplayCurrencyProvider locale={locale}><CorporateShell locale={locale}>{q.view==='dashboard'?<YaqeenDashboard model={yaqeenDashboardDemo} ar={locale==='ar'} locale={locale}/>:<ThemeReview ar={locale==='ar'}/>}</CorporateShell></DisplayCurrencyProvider>;}
