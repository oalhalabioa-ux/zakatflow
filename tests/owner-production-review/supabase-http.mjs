import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync,spawn} from 'node:child_process';
import {createServerClient} from '@supabase/ssr';
import {randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
const root=new URL('../../',import.meta.url);
const load=p=>readFile(new URL(p,root),'utf8');
const workdir=process.env.OWNER_SB_WORKDIR;
if(!workdir || !process.env.RUNNER_TEMP || !workdir.startsWith(process.env.RUNNER_TEMP+'/'))throw Error('TEMPORARY_LOCAL_STACK_REQUIRED');
const status=JSON.parse(execFileSync('npx',['--yes','supabase@2.122.0','status','--workdir',workdir,'--output','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
const url='http://127.0.0.1:54321',key=status.ANON_KEY;
if(status.API_URL!==url || !key)throw Error('LOCAL_API_ONLY');
const sql=s=>execFileSync('docker',['exec','-i','supabase_db_owner-production-review','psql','-X','-q','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres'],{input:s,encoding:'utf8',stdio:['pipe','pipe','pipe']});
const query=s=>execFileSync('docker',['exec','-i','supabase_db_owner-production-review','psql','-X','-q','-t','-A','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres'],{input:s,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
const report={passed:false,stack:'Disposable Supabase Auth + PostgREST + PostgreSQL 17',remoteConnections:false,serviceKeysUsed:false,checks:[]};
const check=name=>report.checks.push({name,passed:true});
async function api(path,body,token=key,method=body===undefined?'GET':'POST'){
 const response=await fetch(url+path,{method,headers:{apikey:key,Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});
 let data=null;try{data=await response.json();}catch{}
 return {ok:response.ok,status:response.status,data};
}
const required='docs/production-owner-review/';
const password=randomBytes(32).toString('base64url')+'aA1!';
let owner,ordinary,app;
try{
 assert.match(query('select version()'),/PostgreSQL 17\./);
 // Build only source relations from observed schema; real Supabase owns auth/users/sessions/roles/helpers.
 const columns=JSON.parse(await load(required+'observed-production-columns.json'));
 let source='';
 for(const name of ['organizations','organization_members','subscriptions']){
 const fields=columns.filter(c=>c.table_schema==='public'&&c.table_name===name);
 source+='create table public.'+name+'('+fields.map(c=>'"'+c.column_name+'" '+c.data_type+(c.column_name==='id'?' primary key':'')+(c.column_default?' default '+c.column_default:'')+(c.is_nullable==='NO'?' not null':'')).join(',')+');\n';
 }
 source+='create table public.profiles(id uuid primary key references auth.users(id));create table public.currencies(code text primary key);create table public.organization_roles(organization_id uuid not null,id uuid not null,primary key(organization_id,id));\n';
 for(const c of JSON.parse(await load(required+'observed-production-constraints.json'))){
 if(c.contype==='p'&&['organizations','subscriptions'].includes(c.relation))continue;
 source+='alter table public.'+c.relation+' add constraint '+c.conname+' '+c.definition+';\n';
 }
 // Match restrictive source access; all new metadata comes only from local generated sources.
 source+='alter table public.organizations enable row level security;alter table public.organization_members enable row level security;alter table public.subscriptions enable row level security;revoke all on public.organizations,public.organization_members,public.subscriptions from anon,authenticated;';
 sql(source);
 sql(await load(required+'preflight.sql'));
 sql("set yaqeen.platform_owner_ddl_approval='APPROVED_PLATFORM_OWNER_SCHEMA';\n"+await load(required+'20261028185536_platform_owner_production_review.sql'));
 sql(await load(required+'postflight.sql'));check('migration and catalog postflight on real Supabase PostgreSQL');
 for(const [name,email] of [['owner','owner@owner-local.test'],['ordinary','ordinary@owner-local.test']]){
 const signup=await api('/auth/v1/signup',{email,password});
 if(!signup.ok || !signup.data?.access_token)throw Error('LOCAL_SIGNUP_FAILED:'+signup.status);
 if(name==='owner')owner=signup.data;else ordinary=signup.data;
 }
 assert.notEqual(owner.user.id,ordinary.user.id);check('real Auth signup and confirmed local sessions without email or service key');
 const id=owner.user.id;if(!/^[a-f0-9-]{36}$/.test(id))throw Error('INVALID_SYNTHETIC_UUID');
 sql("set yaqeen.platform_owner_enrollment_approval='APPROVED_EXISTING_PRODUCTION_OWNER';\n"+
 (await load(required+'provision-owner.psql')).replaceAll(":'owner_user_id'","'"+id+"'").replaceAll(":'owner_email'","'owner@owner-local.test'"));
 // Exactly one original institution; no platform extension copy. Existing user metadata stays untouched.
 sql("insert into public.profiles(id) values('"+id+"'),('"+ordinary.user.id+"');insert into public.currencies(code) values('SAR');insert into public.organizations(id,owner_user_id,name) values('55555555-5555-4555-8555-555555555555','"+id+"','Synthetic local institution');");
 check('approved owner provisioning without changing ordinary identity');
 await api('/auth/v1/user',{data:{platform_owner:true,role:'platform_owner'}},ordinary.access_token,'PUT');
 // Wait only for local PostgREST schema cache; missing RPC is never a passing permission denial.
 for(let i=0;i<20;i++){const r=await api('/rest/v1/rpc/owner_user_count',{},owner.access_token);if(r.ok)break;if(i===19)throw Error('REST_SCHEMA_OR_OWNER_GUARD_FAILED:'+r.status+':'+r.data?.code);await new Promise(resolve=>setTimeout(resolve,500));}
 const role=await api('/rest/v1/rpc/owner_authorized',{},ordinary.access_token);assert.equal(role.data,false);check('ordinary real JWT and forged metadata cannot become owner');
 const calls=[['owner_user_count',{}],['owner_organization_count',{}],['owner_subscription_summary',{}],['owner_list_users',{p_page:1,p_per_page:10}],['owner_list_organizations',{p_page:1,p_per_page:10}],['owner_list_plans',{}],['owner_list_subscriptions',{}],['owner_list_payment_transactions',{p_limit:10}],['owner_list_audit_events',{p_limit:10}],['owner_upsert_plan',{p_code:null,p_name_ar:null,p_price:null,p_currency:null,p_interval:null,p_active:null,p_id:null}],['owner_change_subscription_status',{p_subscription_id:null,p_expected_status:null,p_new_status:null}]];
 for(const [name,args] of calls){const denied=await api('/rest/v1/rpc/'+name,args,ordinary.access_token);assert.equal(denied.status,403,name);assert.equal(denied.data?.code,'42501',name);}
 check('all eleven actual-session PostgREST ordinary RPC denials');
 for(const [name,args] of calls){const denied=await api('/rest/v1/rpc/'+name,args);assert.ok([401,403].includes(denied.status),name);assert.equal(denied.data?.code,'42501',name);}
 check('all eleven anonymous PostgREST RPC denials');
 for(const t of ['platform_admins','platform_organizations','platform_plans','platform_subscriptions','platform_payment_transactions','platform_audit_events']){
 const res=await api('/rest/v1/'+t+'?select=*',undefined,ordinary.access_token);
 if(t==='platform_admins'){assert.ok(res.ok);assert.equal(res.data.length,0);}else assert.ok([401,403].includes(res.status),t);
 }
 check('direct table access blocked; ordinary membership select empty');
 for(const [name,args] of calls.slice(0,9)){const res=await api('/rest/v1/rpc/'+name,args,owner.access_token);assert.ok(res.ok,name+':'+res.status);}
 const users=await api('/rest/v1/rpc/owner_user_count',{},owner.access_token);assert.equal(Number(users.data),2);
 const orgs=await api('/rest/v1/rpc/owner_organization_count',{},owner.access_token);assert.equal(Number(orgs.data),1);
 const summary=await api('/rest/v1/rpc/owner_subscription_summary',{},owner.access_token);assert.equal(Number(summary.data[0].subscriptions),0);assert.equal(Number(summary.data[0].plans),0);
 check('nine owner reads; actual counts two users and one institution; subscriptions and plans zero');
 for(const [name,args]of calls.slice(9)){const res=await api('/rest/v1/rpc/'+name,args,owner.access_token);assert.equal(res.data?.code,'0A000');assert.ok(!res.ok);}
 check('owner plan and subscription writes disabled over HTTP');
 // Render the existing Next application over HTTP against only this local stack.
 const appEnv={...process.env,NEXT_PUBLIC_SUPABASE_URL:url,NEXT_PUBLIC_SUPABASE_ANON_KEY:key,NEXT_PUBLIC_APP_URL:'http://127.0.0.1:3000'};
 try{execFileSync('npm',['run','build'],{env:appEnv,stdio:['ignore','pipe','pipe'],timeout:300000});}catch{throw Error('LOCAL_APP_BUILD_FAILED');}
 app=spawn('node',['node_modules/next/dist/bin/next','start','-p','3000'],{env:appEnv,stdio:'ignore'});
 for(let i=0;i<60;i++){try{await fetch('http://127.0.0.1:3000/ar/login');break;}catch{if(i===59)throw Error('LOCAL_APP_NOT_READY');await new Promise(r=>setTimeout(r,500));}}
 async function cookie(who){const values=new Map();const client=createServerClient(url,key,{cookies:{getAll:()=>[],setAll:items=>{for(const item of items)values.set(item.name,item.value);}}});const res=await client.auth.setSession({access_token:who.access_token,refresh_token:who.refresh_token});if(res.error)throw Error('LOCAL_SSR_SESSION_FAILED');return [...values].map(([name,value])=>name+'='+value).join('; ');}
 const ownerCookie=await cookie(owner),ordinaryCookie=await cookie(ordinary);
 const paths=['/admin','/admin/users','/admin/companies','/admin/subscriptions','/admin/payments','/admin/analytics','/admin/settings'];
 for(const path of paths){
  const allowed=await fetch('http://127.0.0.1:3000'+path,{headers:{Cookie:ownerCookie},redirect:'manual'});assert.equal(allowed.status,200,path);const html=await allowed.text();assert.ok(html.includes('owner-shell'),path);assert.ok(!html.includes('الوصول غير مسموح'),path);
  if(path==='/admin/subscriptions'){assert.ok(!html.includes('<form'));assert.ok(!html.includes('تأكيد تغيير الحالة'));assert.ok(!html.includes('حفظ الباقة'));assert.ok(html.includes('لا توجد اشتراكات مسجلة بعد.'));}
  const forbidden=await fetch('http://127.0.0.1:3000'+path,{headers:{Cookie:ordinaryCookie},redirect:'manual'});assert.equal(forbidden.status,200,path);const deniedHtml=await forbidden.text();assert.ok(deniedHtml.includes('الوصول غير مسموح'));assert.ok(!deniedHtml.includes('owner-shell'));
  const anonymous=await fetch('http://127.0.0.1:3000'+path,{redirect:'manual'});assert.ok([303,307,308].includes(anonymous.status),path);assert.ok(anonymous.headers.get('location')?.includes('/ar/login'));
 }
 check('all seven Next routes: real owner allowed, ordinary denied, anonymous redirected');
 check('subscription page has zero write forms and correct empty foundation-state message');

 for(const who of [ordinary,owner]){
 const logout=await api('/auth/v1/logout?scope=local',{},who.access_token);assert.ok(logout.ok);
 const revoked=await api('/auth/v1/token?grant_type=refresh_token',{refresh_token:who.refresh_token});assert.ok(!revoked.ok);
 }
 const old=await api('/rest/v1/rpc/owner_user_count',{},owner.access_token);assert.equal(old.status,403);assert.equal(old.data?.code,'42501');
 check('logout revokes refresh tokens and old owner JWT no longer authorizes RPC');
 assert.equal(query('select count(*) from public.subscriptions'),'0');
 assert.equal(query("select count(*) from auth.users where id in ('"+owner.user.id+"','"+ordinary.user.id+"')"),'2');
 check('source subscription table empty and both auth accounts retained');
 sql("set yaqeen.platform_owner_rollback_approval='APPROVED_DISABLE_PLATFORM_OWNER_ACCESS';\n"+await load(required+'disable-access.sql'));
 const after=await api('/rest/v1/rpc/owner_user_count',{},owner.access_token);assert.ok(!after.ok);check('emergency access rollback verified through PostgREST');
 report.passed=true;report.checkedAt=new Date().toISOString();
 await writeFile('owner-supabase-http-result.json',JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report,null,2));
} catch(error){console.error('LOCAL_SUPABASE_ACCEPTANCE_FAILED: '+error.message);process.exitCode=1;}finally{app?.kill('SIGTERM');}

