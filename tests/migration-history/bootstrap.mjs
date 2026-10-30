// Runs only on disposable local Supabase. Never links, migrates or queries a hosted project.
import {execFileSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';
import {verifyFiles} from './verify-files.mjs';
const dir=process.env.HISTORY_QA_WORKDIR;
assert.ok(dir&&process.env.RUNNER_TEMP&&dir.startsWith(process.env.RUNNER_TEMP+'/'),'Disposable workdir required');
const status=JSON.parse(execFileSync('npx',['--yes','supabase@2.122.0','status','--workdir',dir,'--output','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
assert.equal(status.API_URL,'http://127.0.0.1:54321');
const root=new URL('../../',import.meta.url);
const load=p=>readFile(new URL(p,root),'utf8');
const sql=input=>execFileSync('docker',['exec','-i','supabase_db_migration-history-qa','psql','-X','-q','-t','-A','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres'],{input,encoding:'utf8',stdio:['pipe','pipe','pipe'],maxBuffer:8*1024*1024}).trim();
const checks=[];const check=async(name,run)=>{await run();checks.push({name,status:'passed'});console.log('PASS '+name)};
try{
 const manifest=await verifyFiles();
 await check('all canonical migration versions applied to a fresh local database',async()=>{
  const versions=JSON.parse(sql("select coalesce(jsonb_agg(version order by version),'[]') from supabase_migrations.schema_migrations"));
  assert.deepEqual(versions,manifest.entries.map(x=>x.version).sort());
 });
 await check('fresh bootstrap matches every observed application schema object',async()=>{
  const query=await load('tests/migration-history/catalog.sql');
  const actual=JSON.parse(sql('select coalesce(jsonb_agg(t),\'[]\') from ('+query.replace(/;\s*$/,'')+') t'));
  const expected=(await load('tests/migration-history/observed-schema.jsonl')).trim().split('\n').map(x=>JSON.parse(x));
  const lookup=new Map(actual.map(x=>[x.category+':'+x.object_key,x.fingerprint]));
  const differences=expected.filter(x=>lookup.get(x.category+':'+x.object_key)!==x.fingerprint).map(x=>({category:x.category,object:x.object_key,kind:lookup.has(x.category+':'+x.object_key)?'different':'missing'}));
  const keys=new Set(expected.map(x=>x.category+':'+x.object_key));
  for(const x of actual)if(!keys.has(x.category+':'+x.object_key))differences.push({category:x.category,object:x.object_key,kind:'extra'});
  await writeFile(new URL('tests/migration-history/schema-differences.json',root),JSON.stringify(differences,null,2)+'\n');
  assert.equal(differences.length,0,'Schema differences: '+JSON.stringify(differences.slice(0,15)));
 });
 await check('bootstrap contains no customer, owner, membership or subscription records',async()=>{
  assert.equal(sql('select (select count(*) from auth.users)+(select count(*) from organizations)+(select count(*) from organization_members)+(select count(*) from platform_admins)+(select count(*) from platform_subscriptions)'), '0');
  assert.equal(sql('select count(*) from pg_policies where schemaname=\'public\''),'173');
  assert.equal(sql('select count(*) from subscription_private.guard_coverage'),'99');
 });
 const admin=createClient(status.API_URL,status.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 const client=createClient(status.API_URL,status.ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 const email='history-owner@qa.local.test',password=randomBytes(24).toString('base64url')+'7a';
 const made=await admin.auth.admin.createUser({email,password,email_confirm:true});assert.ifError(made.error);const user=made.data.user;
 assert.ifError((await client.auth.signInWithPassword({email,password})).error);
 let org,account;
 await check('full historical schema creates exactly one 30-day five-seat institution trial through real PostgREST',async()=>{
  const r=await client.from('organizations').insert({owner_user_id:user.id,name:'Synthetic migration institution',entity_type:'COMPANY'}).select('id').single();assert.ifError(r.error);org=r.data.id;
  const e=await client.rpc('organization_subscription',{p_organization_id:org});assert.ifError(e.error);
  assert.equal(e.data.status,'trialing');assert.equal(e.data.active_users,1);assert.equal(e.data.max_users,5);
  assert.equal(new Date(e.data.trial_ends_at)-new Date(e.data.trial_started_at),30*86400000);
 });
 await check('actual financial schema allows entitled cash account writes',async()=>{
  const r=await client.from('liquidity_accounts').insert({organization_id:org,name:'Synthetic bank',account_type:'BANK',currency:'SAR',created_by:user.id}).select('id').single();assert.ifError(r.error);account=r.data.id;
 });
 await check('expiry rejects actual-schema API mutation and preserves CSV export',async()=>{
  sql(`update public.platform_subscriptions set trial_started_at=now()-interval '31 days',trial_ends_at=now()-interval '1 day' where organization_id='${org}';`);
  const write=await client.from('liquidity_accounts').update({name:'Blocked change'}).eq('id',account);assert.match(write.error?.message??'',/SUBSCRIPTION_READ_ONLY/);
  const read=await client.from('liquidity_accounts').select('name').eq('id',account).csv();assert.ifError(read.error);assert.ok(read.data.includes('Synthetic bank'));
 });
 await check('ordinary user cannot extend; live owner extension audits and restores actual-schema writes',async()=>{
  const args={p_action:'extend',p_reason:'Synthetic acceptance extension',p_organization_id:org,p_revision:1,p_days:3,p_until:null,p_plan_id:null,p_max_users:null};
  const denied=await client.rpc('owner_manage_trial',args);assert.match(denied.error?.message??'',/PLATFORM_OWNER_REQUIRED/);
  sql(`insert into public.platform_admins(user_id,role) values('${user.id}','platform_owner');`);
  const extended=await client.rpc('owner_manage_trial',args);assert.ifError(extended.error);
  assert.ifError((await client.from('liquidity_accounts').update({name:'Extended bank'}).eq('id',account)).error);
  assert.equal(sql("select count(*) from public.platform_audit_events where event_type='subscription.extend'"),'1');
 });
 await check('schema adoption replay preserves populated financial records and rejects unexpected schema',async()=>{
  const plan=sql(`insert into public.budget_plans(user_id,created_by,name,fiscal_year,organization_id) values('${user.id}','${user.id}','Preserved synthetic budget',2026,'${org}') returning id;`);
  sql(`insert into public.budget_lines(plan_id,user_id,category,name,line_type,monthly_budget) values('${plan}','${user.id}','REVENUE','Preserved amount','REVENUE',array_fill(123.45::numeric,ARRAY[12]));`);
  const fingerprint=()=>sql(`select md5(coalesce(string_agg(to_jsonb(b)::text,'' order by id),'')) from public.budget_lines b where plan_id='${plan}';`);
  const before=fingerprint(),adoption=await load('supabase/migrations/20261030212327_adopt_existing_budget_schema.sql');
  sql(adoption);assert.equal(fingerprint(),before);
  assert.throws(()=>sql('begin;alter table public.budget_lines alter column active drop not null;'+adoption),error=>error.stderr?.toString().includes('UNEXPECTED_BUDGET_ACTIVE_COLUMN'));
  assert.equal(fingerprint(),before);
 });
}catch(error){checks.push({name:String(error.message).slice(0,2000),status:'failed'});process.exitCode=1;console.error('FAIL '+String(error.message).slice(0,2000));}
finally{await writeFile(new URL('tests/migration-history/bootstrap-result.json',root),JSON.stringify({checks,hostedDatabasesAccessed:false,syntheticAccountsOnly:true},null,2)+'\n');}
