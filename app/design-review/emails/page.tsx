import {notFound} from 'next/navigation';
import Link from 'next/link';
import previews from '@/lib/email/previews.json';
import copy from '@/lib/email/copy.json';
import {organizationInvitationEmail} from '@/lib/email/organization-invitation';
export const metadata={robots:{index:false,follow:false}};
export default async function EmailReview({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}){
 if(process.env.NEXT_PUBLIC_APP_ENV!=='qa')notFound();
 const q=await searchParams,locale=q.lang==='en'?'en':'ar',kind=q.kind??'organization';
 const registry=previews as Record<string,string>;
 const html=kind==='organization'?organizationInvitationEmail({locale,organization:locale==='ar'?'مؤسسة نموذجية':'Example Organization',email:'invited@example.test',role:'VIEWER',expiresAt:new Date(Date.now()+7*86400000).toISOString(),inviteUrl:`https://app.yaqeenbiz.com/${locale}/login?invite=preview-invitation-not-valid`}).html:registry[kind+'.'+locale];
 if(!html)notFound();
 const kinds=['organization',...Object.keys(copy).filter(x=>!['shared','organization','roles'].includes(x))];
 return <main style={{padding:24,background:'#f3f5f7',color:'#102c46',minHeight:'100vh'}}><h1>{locale==='ar'?'معاينة رسائل يقين الأعمال':'Yaqeen Business email review'}</h1><p>{locale==='ar'?'بيانات نموذجية فقط. لا تُرسل رسائل من هذه الصفحة.':'Sample data only. This page does not send emails.'}</p><nav style={{display:'flex',gap:12,flexWrap:'wrap',marginBottom:20}}>{kinds.map(name=><Link key={name} href={`?kind=${name}&lang=${locale}`}>{name}</Link>)}<Link href={`?kind=${kind}&lang=${locale==='ar'?'en':'ar'}`}>{locale==='ar'?'English':'العربية'}</Link></nav><iframe title={`${kind} ${locale} email preview`} sandbox="" srcDoc={html} style={{display:'block',width:'100%',maxWidth:650,height:1000,border:'1px solid #ddd',margin:'auto'}}/></main>
}
