/** Optional transactional study email invitation. This is QA-only, OFF by
 * default, and uses a verified sender. No secrets or invitation codes are logged.
 * Recipient must still sign up, verify the invited address and pass entitlement.
 */
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type InviteLocale='ar'|'en';
export type InvitationEmailArgs={
 to:string;code:string;role:'VIEWER'|'REVIEWER';locale:InviteLocale;
 invitationId:string;expiresAt:string;
};
function config(){
 if(process.env.FEASIBILITY_INVITATION_EMAIL_QA!=='true')return null;
 const key=process.env.RESEND_API_KEY?.trim();
 const from=process.env.FEASIBILITY_INVITE_FROM_EMAIL?.trim();
 const origin=process.env.FEASIBILITY_INVITE_PUBLIC_ORIGIN?.trim();
 if(!key||!from||!origin||!from.includes('@'))return null;
 try{
  const url=new URL(origin);
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||
   url.pathname!=='/'||url.hostname==='localhost')return null;
  return {key,from,origin:url.origin};
 }catch{return null}
}
export const emailInvitationsReady=()=>Boolean(config());

/** Returns a Resend message ID after provider acknowledgement, never a
 * delivery-to-inbox claim. Only the intended recipient sees the secret.
 */
export async function sendFeasibilityInvitationEmail(input:InvitationEmailArgs):Promise<string>{
 const cfg=config();
 if(!cfg||!uuid.test(input.invitationId)||
  !/^[A-Za-z0-9_-]{43}$/.test(input.code)||
  !/^\S+@\S+\.\S+$/.test(input.to))throw Error('EMAIL_INVITATION_NOT_READY');
 const ar=input.locale==='ar';
 const role=ar?(input.role==='REVIEWER'?'المراجعة':'الاطلاع'):
  (input.role==='REVIEWER'?'Review':'View');
 const subject=ar?'دعوة إلى دراسة جدوى في يقين الأعمال':'Invitation to a Yaqeen Business feasibility study';
 const url=cfg.origin+'/'+input.locale+'/feasibility';
 const textBody=ar?
  'وصلتك دعوة إلى دراسة جدوى في يقين الأعمال.\nالصلاحية: '+role+
   '\nافتح '+url+' بعد تسجيل الدخول بالبريد المدعو وتأكيده، ثم ألصق رمز الدعوة:\n'+
   input.code+'\nتنتهي الدعوة: '+input.expiresAt+
   '\nلا تشارك هذا الرمز مع أي شخص.':
  'You were invited to a feasibility study in Yaqeen Business.\nRole: '+role+
   '\nSign in using this verified email at '+url+' and paste this one-time invitation code:\n'+
   input.code+'\nExpires: '+input.expiresAt+
   '\nDo not share this code with anyone.';
 const response=await fetch('https://api.resend.com/emails',{
  method:'POST',
  headers:{
   'Authorization':'Bearer '+cfg.key,
   'Content-Type':'application/json',
   'Idempotency-Key':'feasibility-invitation-'+input.invitationId
  },
  body:JSON.stringify({
   from:cfg.from,to:[input.to],subject,text:textBody
  }),
  signal:AbortSignal.timeout(10000)
 });
 if(!response.ok)throw Error('EMAIL_PROVIDER_REJECTED');
 const body=await response.json() as {id?:unknown};
 if(typeof body.id!=='string'||!body.id)throw Error('EMAIL_PROVIDER_NO_ACK');
 return body.id;
}
