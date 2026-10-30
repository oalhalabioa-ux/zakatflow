// Runs only against a temporary GitHub Actions Supabase stack; no cloud credentials or user data.
import {execFileSync,spawn} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';
import {createServerClient} from '@supabase/ssr';
import {browserAcceptance} from './auth-browser-acceptance.mjs';
const dir=process.env.AUTH_QA_WORKDIR;
assert.ok(dir&&process.env.RUNNER_TEMP&&dir.startsWith(process.env.RUNNER_TEMP+'/'),'Temporary stack only');
const status=JSON.parse(execFileSync('npx',['--yes','supabase@2.122.0','status','--workdir',dir,'--output','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
const api='http://127.0.0.1:54321',appUrl='http://127.0.0.1:3000',mailUrl=status.INBUCKET_URL??'http://127.0.0.1:54324';
assert.equal(status.API_URL,api);assert.ok(mailUrl.startsWith('http://127.0.0.1:'));
const fresh=()=>createClient(api,status.ANON_KEY,{auth:{autoRefreshToken:false,persistSession:false}});
const sql=input=>execFileSync('docker',['exec','-i','supabase_db_auth-registration-qa','psql','-X','-q','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres'],{input,encoding:'utf8',stdio:['pipe','pipe','pipe']});
const checks=[];let app;
const check=async(name,fn)=>{await fn();checks.push({name,status:'passed'});console.log('PASS '+name)};
async function emailFor(email,contains,excludeLink){for(let i=0;i<40;i++){const inbox=await (await fetch(mailUrl+'/api/v1/messages')).json();for(const msg of inbox.messages??[]){if(!msg.To?.some(t=>t.Address===email))continue;const full=await (await fetch(mailUrl+'/api/v1/message/'+msg.ID)).json();const html=full.HTML??'';if((contains?(contains==='recovery'?html.includes('type=recovery'):html.includes(contains)):Boolean(linkFrom(full)))&&(!excludeLink||linkFrom(full)!==excludeLink))return full;}await new Promise(r=>setTimeout(r,500))}throw Error('Local verification email missing')}

function linkFrom(mail){const html=mail.HTML??mail.html??'';const hrefs=[...html.matchAll(/href="([^"]+)"/g)].map(m=>m[1].replaceAll('&amp;','&'));return hrefs.find(h=>h.includes('token_hash='))??hrefs.find(h=>h.includes('/auth/v1/verify'))}
try{
 // Minimal, explicit test-only ownership fixture; never presented as a full Production schema audit.
 sql(`create table public.auth_qa_financial_data(id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users(id));alter table public.auth_qa_financial_data enable row level security;grant select on public.auth_qa_financial_data to anon,authenticated;create policy own_rows on public.auth_qa_financial_data for select to authenticated using((select auth.uid())=owner_id);notify pgrst,'reload schema';`);
 const env={...process.env,NEXT_PUBLIC_SUPABASE_URL:api,NEXT_PUBLIC_SUPABASE_ANON_KEY:status.ANON_KEY,NEXT_PUBLIC_APP_URL:appUrl,NEXT_PUBLIC_APP_ENV:'test',SUPABASE_SERVICE_ROLE_KEY:''};
 try{execFileSync('npm',['run','build'],{env,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:300000})}catch{throw Error('Isolated application build failed')}
 app=spawn('node',['node_modules/next/dist/bin/next','start','-p','3000'],{env,stdio:'ignore'});
 for(let n=0;n<60;n++){try{await fetch(appUrl+'/en/login');break}catch{if(n===59)throw Error('App unavailable');await new Promise(r=>setTimeout(r,500))}}
 for(const locale of ['ar','en']){
  const email=`auth-${locale}@qa.local.test`,password=randomBytes(24).toString('base64url')+'7a';
  const redirectTo=appUrl+`/auth/callback?lang=${locale}&next=%2F${locale}%2Fdashboard&flow=signup`;
  let account,session,confirmedLink;
  await check(`${locale}: public signup issues email without financial session`,async()=>{const r=await fresh().auth.signUp({email,password,options:{emailRedirectTo:redirectTo,data:{full_name:'QA Test',phone:'+966500000000',locale}}});assert.ifError(r.error);account=r.data.user;assert.ok(account);assert.equal(r.data.session,null);const bad=await fresh().auth.signInWithPassword({email,password});assert.equal(bad.error?.code,'email_not_confirmed');const anon=await fresh().from('auth_qa_financial_data').select('id');assert.ifError(anon.error);assert.equal(anon.data.length,0)});
  await check(`${locale}: actual email template and scanner-safe app confirmation`,async()=>{const mail=await emailFor(email),html=mail.HTML??'';assert.equal(mail.Subject,locale==='en'?'Verify your email address — Yaqeen Business':'تأكيد بريدك الإلكتروني — يقين الأعمال');assert.ok(html.includes(locale==='en'?'Verify your email address':'تأكيد بريدك الإلكتروني'));assert.ok(!html.includes(locale==='en'?'تأكيد بريدك الإلكتروني':'Verify your email address'));confirmedLink=linkFrom(mail);assert.ok(confirmedLink?.startsWith(appUrl+'/auth/callback?'));const landing=await fetch(confirmedLink,{redirect:'follow'});assert.equal(landing.status,200);assert.equal(landing.headers.get('referrer-policy'),'strict-origin');assert.ok((await landing.text()).includes('method="post"'));const notYet=await fresh().auth.signInWithPassword({email,password});assert.equal(notYet.error?.code,'email_not_confirmed');const data=new URL(confirmedLink).searchParams;const result=await fetch(appUrl+'/auth/confirm',{method:'POST',headers:{Origin:appUrl},body:data,redirect:'manual'});assert.equal(result.status,303);assert.equal(result.headers.get('location'),appUrl+`/${locale}/dashboard`);assert.ok(result.headers.get('set-cookie'));const reused=await fetch(appUrl+'/auth/confirm',{method:'POST',headers:{Origin:appUrl},body:data,redirect:'manual'});assert.ok(reused.headers.get('location').includes('error=verification'))});
  await check(`${locale}: correct/wrong password, refresh and server cookie persistence`,async()=>{const c=fresh();assert.ok((await c.auth.signInWithPassword({email,password:password+'x'})).error);const good=await c.auth.signInWithPassword({email,password});assert.ifError(good.error);session=good.data.session;const cookies=new Map();const ssr=createServerClient(api,status.ANON_KEY,{cookies:{getAll:()=>[],setAll:items=>items.forEach(c=>cookies.set(c.name,c.value))}});assert.ifError((await ssr.auth.setSession(session)).error);const cookie=[...cookies].map(([k,v])=>k+'='+v).join('; ');for(let n=0;n<2;n++){const response=await fetch(appUrl+`/${locale}/account`,{headers:{Cookie:cookie},redirect:'manual'});assert.equal(response.status,200)}assert.ifError((await c.auth.refreshSession()).error);assert.ifError((await c.auth.signOut()).error);assert.equal((await c.auth.getSession()).data.session,null)});
  await check(`${locale}: duplicate signup never duplicates the Auth account`,async()=>{const duplicate=await fresh().auth.signUp({email,password,options:{emailRedirectTo:redirectTo}});assert.equal(duplicate.data.session,null);assert.ok(duplicate.error||duplicate.data.user?.identities?.length===0)});
  await check(`${locale}: PostgREST rejects cross-user data and forged admin metadata`,async()=>{const c=fresh();assert.ifError((await c.auth.signInWithPassword({email,password})).error);assert.ifError((await c.auth.updateUser({data:{role:'platform_owner'}})).error);sql(`insert into public.auth_qa_financial_data(owner_id) values('${account.id}')`);const other=await fresh().from('auth_qa_financial_data').select('id');assert.ifError(other.error);assert.equal(other.data.length,0);const own=await c.from('auth_qa_financial_data').select('id');assert.ifError(own.error);assert.equal(own.data.length,1);const admin=await fetch(appUrl+`/admin?lang=${locale}`,{redirect:'manual'});assert.ok([303,307,308].includes(admin.status))});
  // A different synthetic email avoids signup/mail throttle; no external messages are sent.
  await check(`${locale}: quick link cannot auto-create an unknown user`,async()=>{const unknown=await fresh().auth.signInWithOtp({email:`unknown-${locale}@qa.local.test`,options:{shouldCreateUser:false,emailRedirectTo:redirectTo}});assert.ok(unknown.error);assert.equal(unknown.data.session,null)});
  await check(`${locale}: real quick-link email and app sign-in`,async()=>{const c=fresh();assert.ifError((await c.auth.signInWithOtp({email,options:{shouldCreateUser:false,emailRedirectTo:redirectTo.replace('&flow=signup','')}})).error);const mail=await emailFor(email,locale==='en'?'Your quick sign-in link':'رابط الدخول السريع');assert.equal(mail.Subject,locale==='en'?'Your quick sign-in link — Yaqeen Business':'رابط الدخول السريع — يقين الأعمال');const link=linkFrom(mail);assert.ok(link);const params=new URL(link).searchParams;assert.equal(params.get('type'),'email');const result=await fetch(appUrl+'/auth/confirm',{method:'POST',headers:{Origin:appUrl},body:params,redirect:'manual'});assert.equal(result.headers.get('location'),appUrl+`/${locale}/dashboard`)});
  await check(`${locale}: actual recovery email and password update for synthetic user`,async()=>{await new Promise(r=>setTimeout(r,1200));const c=fresh();assert.ifError((await c.auth.resetPasswordForEmail(email,{redirectTo:appUrl+`/auth/callback?lang=${locale}&next=%2Fauth%2Freset-password%3Flang%3D${locale}`})).error);const mail=await emailFor(email,'recovery');const raw=(mail.HTML??'').match(/href="([^"]+)"/)[1].replaceAll('&amp;','&');const token=new URL(raw).searchParams.get('token');assert.ok(token);const verified=await c.auth.verifyOtp({token_hash:token,type:'recovery'});assert.ifError(verified.error);assert.ifError((await c.auth.updateUser({password:password+'2'})).error);assert.ifError((await fresh().auth.signInWithPassword({email,password:password+'2'})).error);assert.ifError((await c.auth.updateUser({password})).error)});
  await check(`${locale}: actual expired confirmation and resend retain the account`,async()=>{const expiredEmail=`expired-${locale}@qa.local.test`;const c=fresh();const signup=await c.auth.signUp({email:expiredEmail,password,options:{emailRedirectTo:redirectTo,data:{locale}}});assert.ifError(signup.error);const id=signup.data.user.id;const first=linkFrom(await emailFor(expiredEmail));sql(`update auth.users set confirmation_sent_at=now()-interval '2 hours' where id='${id}'`);const failed=await fetch(appUrl+'/auth/confirm',{method:'POST',headers:{Origin:appUrl},body:new URL(first).searchParams,redirect:'manual'});assert.ok(failed.headers.get('location').includes('error=verification'));const blocked=await c.auth.signInWithPassword({email:expiredEmail,password});assert.equal(blocked.error?.code,'email_not_confirmed');const resend=await c.auth.resend({type:'signup',email:expiredEmail,options:{emailRedirectTo:redirectTo}});assert.ifError(resend.error);const replacement=linkFrom(await emailFor(expiredEmail,undefined,first));assert.notEqual(replacement,first);const completed=await fetch(appUrl+'/auth/confirm',{method:'POST',headers:{Origin:appUrl},body:new URL(replacement).searchParams,redirect:'manual'});assert.equal(completed.headers.get('location'),appUrl+`/${locale}/dashboard`);assert.ifError((await c.auth.signInWithPassword({email:expiredEmail,password})).error)});
  await check(`${locale}: expired token keeps the account and returns translated retry`,async()=>{const data=new URL(confirmedLink).searchParams;data.set('token_hash',randomBytes(32).toString('hex'));const expired=await fetch(appUrl+'/auth/confirm',{method:'POST',headers:{Origin:appUrl},body:data,redirect:'manual'});assert.equal(expired.headers.get('location'),appUrl+`/${locale}/login?error=verification`);assert.ifError((await fresh().auth.signInWithPassword({email,password})).error)});
 }
 const admin=createClient(api,status.SERVICE_ROLE_KEY,{auth:{autoRefreshToken:false,persistSession:false}});
 for(const locale of ['ar','en']){
  await check(`${locale}: real Auth invitation template, scanner protection and initial password`,async()=>{
   const email=`invite-${locale}@qa.local.test`,password=randomBytes(24).toString('base64url')+'7a';
   const invited=await admin.auth.admin.inviteUserByEmail(email,{data:{preferred_language:locale},redirectTo:appUrl+`/auth/callback?lang=${locale}`});assert.ifError(invited.error);
   const mail=await emailFor(email,'type=invite'),link=linkFrom(mail);assert.ok((mail.HTML??'').includes(`dir="${locale==='ar'?'rtl':'ltr'}"`));
   assert.equal((await fetch(link)).status,200);const before=await admin.auth.admin.getUserById(invited.data.user.id);assert.ok(!before.data.user.email_confirmed_at);
   const response=await fetch(appUrl+'/auth/confirm',{method:'POST',headers:{Origin:appUrl},body:new URL(link).searchParams,redirect:'manual'});assert.equal(response.headers.get('location'),appUrl+`/auth/reset-password?lang=${locale}&purpose=invite`);
   const user=await admin.auth.admin.getUserById(invited.data.user.id);assert.ok(user.data.user.email_confirmed_at);assert.ok(!user.data.user.app_metadata.role);
   const token=new URL(link).searchParams.get('token_hash');const reused=await fresh().auth.verifyOtp({token_hash:token,type:'invite'});assert.ok(reused.error);
   // Only the isolated synthetic account is assigned a password here.
   assert.ifError((await admin.auth.admin.updateUserById(invited.data.user.id,{password})).error);assert.ifError((await fresh().auth.signInWithPassword({email,password})).error);
  });
  await check(`${locale}: password-change security email uses its separate translated template`,async()=>{const mail=await emailFor(`auth-${locale}@qa.local.test`,locale==='en'?'Your password was changed':'تم تغيير كلمة مرور حسابك');assert.ok((mail.HTML??'').includes(`dir="${locale==='ar'?'rtl':'ltr'}"`));assert.ok(!linkFrom(mail));});
  await check(`${locale}: real email-change template preserves scanner protection and Supabase verification`,async()=>{
   const email=`auth-${locale}@qa.local.test`,nextEmail=`changed-${locale}@qa.local.test`;
   // Recover the isolated user's session using a server-generated local link; no real account is touched.
   const generated=await admin.auth.admin.generateLink({type:'magiclink',email});assert.ifError(generated.error);
   const client=fresh();assert.ifError((await client.auth.verifyOtp({token_hash:generated.data.properties.hashed_token,type:'magiclink'})).error);
   const updated=await client.auth.updateUser({email:nextEmail},{emailRedirectTo:appUrl+`/auth/callback?lang=${locale}`});assert.ifError(updated.error);
   for(const recipient of [email,nextEmail]){
    const mail=await emailFor(recipient,'/auth/email-action?');const html=mail.HTML??'';assert.ok(html.includes(`dir="${locale==='ar'?'rtl':'ltr'}"`));
    const wrapper=[...html.matchAll(/href="([^"]+)"/g)].map(m=>m[1].replaceAll('&amp;','&')).find(x=>x.includes('/auth/email-action?'));assert.ok(wrapper);
    const get=await fetch(wrapper);assert.equal(get.status,200);assert.equal(get.headers.get('referrer-policy'),'strict-origin');
    const before=await admin.auth.admin.getUserById(updated.data.user.id);assert.equal(before.data.user.email,email);
    const params=new URL(wrapper).searchParams;const post=await fetch(appUrl+'/auth/email-action',{method:'POST',headers:{Origin:appUrl},body:params,redirect:'manual'});assert.equal(post.status,303);
    const destination=post.headers.get('location');assert.ok(destination.startsWith(api+'/auth/v1/verify?'));await fetch(destination,{redirect:'manual'});
   }
   const changed=await admin.auth.admin.getUserById(updated.data.user.id);assert.equal(changed.data.user.email,nextEmail);
  });
 }
 const staleCookiesFor=async(email,password)=>{
  const client=fresh(),signed=await client.auth.signInWithPassword({email,password});assert.ifError(signed.error);
  const session=signed.data.session;assert.ok(session);assert.ifError((await client.auth.signOut()).error);
  const value='base64-'+Buffer.from(JSON.stringify({...session,expires_at:1,expires_in:0})).toString('base64url');
  const chunks=[];for(let i=0;i<value.length;i+=3180)chunks.push(value.slice(i,i+3180));
  return chunks.map((value,i)=>({name:'sb-127-auth-token'+(chunks.length>1?'.'+i:''),value,url:appUrl,sameSite:'Lax'}));
 };
 await browserAcceptance({appUrl,emailFor,linkFrom,check,sql,staleCookiesFor});
}catch(error){checks.push({name:error.message,status:'failed'});process.exitCode=1}
finally{app?.kill('SIGTERM');await writeFile('auth-local-acceptance.json',JSON.stringify({checks,cloudDatabasesAccessed:false,financialSchema:'minimal disposable ownership fixture, not a Production RLS audit',google:'not tested: cloud QA Google disabled',emailDelivery:'local Mailpit only; external SMTP untested',verificationPolicy:'24-hour requirement removed by user; hourly Auth link expiry retained; no access before confirmation'},null,2));console.log(JSON.stringify(checks))}
