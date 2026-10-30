import {notFound} from 'next/navigation';
export const dynamic='force-dynamic';
export const metadata={robots:{index:false,follow:false}};
export default async function AuthMobileReview({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}){
 if(process.env.NEXT_PUBLIC_APP_ENV!=='qa')notFound();
 const q=await searchParams,tab=q.tab==='signup'?'signup':'signin',mode=q.mode==='magic'?'magic':'password';
 const state=['verify','magic-sent','expired'].includes(q.state??'')?q.state:undefined;
 const params=new URLSearchParams({tab,mode});if(state==='expired')params.set('error','verification');else if(state)params.set('state',state);
 return <main style={{padding:16,color:'#16283b',background:'#f8f3e9',fontFamily:'sans-serif'}}><h1 style={{fontSize:20}}>Responsive Auth QA · 375 × 812 CSS viewport</h1><p>Real page rendering in isolated browser frames. Touch hardware and native autofill are not emulated.</p><nav style={{display:'flex',gap:16,flexWrap:'wrap'}}>{[['Password','?'],['Quick link','?mode=magic'],['Create account','?tab=signup'],['Link sent','?state=magic-sent'],['Verify email','?tab=signup&state=verify'],['Expired link','?tab=signup&state=expired']].map(([label,url])=><a key={label} href={url}>{label}</a>)}</nav><div style={{display:'flex',gap:24,flexWrap:'wrap',marginTop:20}}>{['ar','en'].map(locale=><section key={locale}><h2>{locale==='ar'?'العربية RTL':'English LTR'}</h2><iframe title={`${locale} authentication at 375 pixels`} src={`/${locale}/login?${params.toString()}`} width="375" height="812" style={{display:'block',border:'1px solid #d9c49e'}}/></section>)}</div></main>
}
