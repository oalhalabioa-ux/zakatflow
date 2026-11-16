// Content generation only. Never changes a hosted Auth project or sends mail.
import {readFile,writeFile} from 'node:fs/promises';
import {emailFrame,emailParagraph,emailButton,escapeEmail} from '../lib/email/design.ts';
const copy=JSON.parse(await readFile(new URL('../lib/email/copy.json',import.meta.url),'utf8'));
const choose='{{ $en := eq (or .Data.preferred_language .Data.locale) "en" }}';
const names=Object.keys(copy).filter(x=>!['shared','organization','roles'].includes(x));
const manifest=[],previews={};
for(const name of names){
 const auth=['invite','email-change','reauthentication'].includes(name);
 let html=choose+'\n{{ if $en }}\n';
 for(const locale of ['en','ar']){
  const c=copy[name][locale],s=copy.shared[locale];
  const url=name==='invite'?`{{ .SiteURL }}/auth/confirm?lang=${locale}&amp;type=invite&amp;token_hash={{ .TokenHash }}`:name==='email-change'?`{{ .SiteURL }}/auth/email-action?lang=${locale}&amp;confirmation_url={{ .ConfirmationURL | urlquery }}`:`{{ .SiteURL }}/${locale}/account`;
  let body=emailParagraph(c.body);
  if(name==='reauthentication')body+=`<p dir="ltr" style="padding:18px;text-align:center;letter-spacing:6px;font-size:30px;font-weight:bold;background:#f8f3e9;color:#102c46;border-radius:8px">{{ .Token }}</p>`+emailParagraph(s.codeSafety);
  else{body+=emailButton(url,c.action).replaceAll('&amp;amp;','&amp;');if(name==='invite')body+=emailParagraph(s.inviteSafety)}
  const frame=emailFrame({locale,title:c.title,body,safety:auth?s.ignore:s.alert,footer:s.footer,tag:s.tag});
  previews[name+'.'+locale]=frame.replaceAll('{{ .SiteURL }}','https://app.yaqeenbiz.com').replaceAll('{{ .TokenHash }}','preview-token-not-valid').replaceAll('{{ .Token }}','12345678').replaceAll('{{ .ConfirmationURL | urlquery }}',encodeURIComponent('https://example.test/preview-only'));
  html+=frame+'\n';
  if(locale==='en')html+='{{ else }}\n';
 }
 html+='{{ end }}\n';
 const subject=choose+`{{ if $en }}${copy[name].en.title} — Yaqeen Business{{ else }}${copy[name].ar.title} — يقين الأعمال{{ end }}`;
 if(subject.length>255)throw Error(name+' subject exceeds hosted limit');
 await writeFile(new URL(`../supabase/templates/${name}.html`,import.meta.url),html);
 await writeFile(new URL(`../supabase/templates/${name}.subject.txt`,import.meta.url),subject+'\n');
 manifest.push({name,kind:auth?'authentication':'security',config:({'email-change':'email_change','password-changed':'password_changed','email-changed':'email_changed','phone-changed':'phone_changed','identity-linked':'identity_linked','identity-unlinked':'identity_unlinked','mfa-enrolled':'mfa_factor_enrolled','mfa-unenrolled':'mfa_factor_unenrolled'})[name]??name});
}
await writeFile(new URL('../supabase/templates/email-suite-manifest.json',import.meta.url),JSON.stringify(manifest,null,2)+'\n');
await writeFile(new URL('../lib/email/previews.json',import.meta.url),JSON.stringify(previews,null,2)+'\n');
console.log(`Prepared ${manifest.length} bilingual Auth templates; no hosted settings changed.`);
