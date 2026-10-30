// Server-only transport. The approved Supabase SMTP settings are never read or changed.
export const invitationEmailConfigured=()=>Boolean(process.env.RESEND_API_KEY?.trim());
export async function sendInvitationEmail(mail:{to:string;subject:string;html:string;text:string;invitationId:string}){
 const key=process.env.RESEND_API_KEY?.trim();
 if(!key)throw Error('EMAIL_DELIVERY_UNAVAILABLE');
 let endpoint='https://api.resend.com/emails';
 // Isolated CI may use a loopback Resend-contract adapter feeding real Mailpit.
 if(process.env.NEXT_PUBLIC_APP_ENV==='test'&&process.env.TRANSACTIONAL_EMAIL_TEST_ENDPOINT){
  const u=new URL(process.env.TRANSACTIONAL_EMAIL_TEST_ENDPOINT);
  if(u.origin!=='http://127.0.0.1:3001'||u.pathname!=='/emails')throw Error('EMAIL_TEST_ENDPOINT_INVALID');
  endpoint=u.href;
 }
 try{
  const response=await fetch(endpoint,{method:'POST',cache:'no-store',signal:AbortSignal.timeout(10000),headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json','Idempotency-Key':`organization-invitation/${mail.invitationId}`},body:JSON.stringify({from:'Yaqeen Business | يقين الأعمال <no-reply@auth.yaqeenbiz.com>',to:[mail.to],subject:mail.subject,html:mail.html,text:mail.text})});
  if(!response.ok)throw Error('EMAIL_DELIVERY_FAILED');
  const data=await response.json();if(typeof data.id!=='string')throw Error('EMAIL_DELIVERY_FAILED');
  return {status:'accepted' as const};
 }catch{throw Error('EMAIL_DELIVERY_FAILED')}
}
