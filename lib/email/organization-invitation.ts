import copy from './copy.json';
import {emailFrame,emailParagraph,emailButton,escapeEmail,type EmailLocale} from './design';
export type OrganizationEmailInput={locale:EmailLocale;organization:string;email:string;role:string;customRoleName?:string|null;expiresAt:string;inviteUrl:string};
export function organizationInvitationEmail(input:OrganizationEmailInput){
 const {locale}=input,c=copy.organization[locale],s=copy.shared[locale];
 const link=new URL(input.inviteUrl);
 if(!(link.origin==='https://app.yaqeenbiz.com'||(process.env.NEXT_PUBLIC_APP_ENV==='qa'&&process.env.VERCEL_URL&&link.origin===`https://${process.env.VERCEL_URL}`)||(process.env.NEXT_PUBLIC_APP_ENV==='test'&&link.origin==='http://127.0.0.1:3000')))throw Error('INVITATION_LINK_INVALID');
 if(!/^\/(ar|en)\/login$/.test(link.pathname)||!link.searchParams.get('invite'))throw Error('INVITATION_LINK_INVALID');
 const roles=copy.roles as Record<string,Record<EmailLocale,string>>;
 if(!roles[input.role])throw Error('INVITATION_ROLE_INVALID');
 const role=input.role==='CUSTOM'?(input.customRoleName||roles.CUSTOM[locale]):roles[input.role][locale];
 const expires=new Date(input.expiresAt);
 if(!Number.isFinite(expires.getTime())||expires.getTime()<=Date.now())throw Error('INVITATION_INVALID_OR_EXPIRED');
 const details=[[c.organization,input.organization],[c.recipient,input.email],[c.role,role],[c.expires,new Intl.DateTimeFormat(locale==='ar'?'ar-SA-u-ca-gregory':'en-GB',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Riyadh'}).format(expires)+' (UTC+03:00)']];
 const body=emailParagraph(c.body)+`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;font-size:14px;line-height:1.9">${details.map(([label,value])=>`<tr><td style="padding:6px;color:#64748b">${escapeEmail(label)}</td><td style="padding:6px;overflow-wrap:anywhere">${escapeEmail(value)}</td></tr>`).join('')}</table>`+emailButton(input.inviteUrl,c.action);
 return {subject:c.title,html:emailFrame({locale,title:c.title,body,safety:c.safety,footer:s.footer,tag:s.tag}),text:[c.title,c.body,...details.map(([a,b])=>a+': '+b),c.action+': '+input.inviteUrl,c.safety,s.footer].join('\n\n')};
}
