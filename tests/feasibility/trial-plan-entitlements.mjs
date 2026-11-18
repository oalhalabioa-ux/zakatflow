import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const modulePath=process.env.FEASIBILITY_PGLITE_MODULE??process.env.TRIAL_PGLITE_MODULE;
assert(modulePath,'Set FEASIBILITY_PGLITE_MODULE to the installed PGlite module');
const {PGlite}=await import(pathToFileURL(modulePath).href);
const load=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const migrationPath='supabase/migrations/20261118174233_feasibility_trial_and_plan_entitlements.sql';
const db=await PGlite.create();
const query=async(sql,args=[]) => (await db.query(sql,args)).rows;
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const [owner,viewer,outsider,existing,newcomer,paid,newPaid,excluded,legacy,plan,withoutPlan]=Array.from({length:11},(_,i)=>id(i+1));
const actor=async(user,run)=>{
 await query("select set_config('request.jwt.claim.sub',$1,false)",[user]);
 await db.exec('set role authenticated');
 try{return await run()}finally{await db.exec('reset role')}
};
const workspace=async(org)=>(await query('select public.feasibility_company_workspace($1) value',[org]))[0].value;
const access=async()=>(await query('select * from private.feasibility_effective_access()'))[0];
const checks=[];
const check=async(name,run)=>{await run();checks.push(name);console.log('PASS '+name)};

try{
 await db.exec(`
  create role authenticated; create role anon; create role service_role;
  create schema auth; create schema private; create schema subscription_private;
  grant usage on schema auth,private to authenticated;
  create function auth.uid() returns uuid language sql stable as
   $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  create table public.organizations(id uuid primary key,status text default 'ACTIVE',subscription_mode text default 'managed');
  create table public.organization_members(organization_id uuid,user_id uuid,role text,status text);
  create table public.platform_plans(id uuid primary key,is_active boolean,is_published boolean,features jsonb,price numeric);
  create table public.platform_subscriptions(
   id uuid primary key default gen_random_uuid(),organization_id uuid,created_at timestamptz default now(),
   plan_id uuid,status text,started_at timestamptz default now(),trial_started_at timestamptz,trial_ends_at timestamptz,
   trial_duration_days int default 30,current_period_end timestamptz,max_users int default 5,revision int default 1,
   converted_at timestamptz,entitlements jsonb,plan_snapshot jsonb
  );
  create table public.feasibility_access_grants(user_id uuid primary key,status text,starts_at timestamptz,ends_at timestamptz,source text);
  create function private.feasibility_phase1_org_enabled() returns boolean language sql stable as $$select true$$;
  grant select on public.organizations,public.organization_members to authenticated;
 `);
 const original=await load('supabase/migrations/20261030150759_organization_trial_entitlements.sql');
 const a=original.indexOf('create function subscription_private.entitlement(p_org uuid)');
 const b=original.indexOf('\ncreate function subscription_private.assert_writable',a);
 await db.exec(original.slice(a,b).replace('subscription_private.entitlement(','subscription_private.entitlement_state('));
 const pricing=await load('supabase/migrations/20261030223910_configurable_subscription_plans.sql');
 const pricingStart=pricing.indexOf('create function subscription_private.entitlement(p_org uuid)');
 const pricingEnd=pricing.indexOf('create function subscription_private.table_capability',pricingStart);
 await db.exec(pricing.slice(pricingStart,pricingEnd));
 const sharing=await load('supabase/migrations/20261116194423_feasibility_organization_sharing.sql');
 const c=sharing.indexOf('create function private.feasibility_has_company_plan');
 const d=sharing.indexOf('\nalter policy feasibility_org_read',c);
 await db.exec(sharing.slice(c,d));
 await db.exec(`
  create table public.feasibility_projects(id uuid primary key,organization_id uuid,created_by_user_id uuid,title text,revision int default 1);
  alter table public.feasibility_projects enable row level security;
  grant select,insert,update on public.feasibility_projects to authenticated;
  create policy read_study on public.feasibility_projects for select to authenticated
   using (private.feasibility_company_access(organization_id,false));
  create policy create_study on public.feasibility_projects for insert to authenticated
   with check (created_by_user_id=auth.uid() and private.feasibility_company_access(organization_id,true));
  create policy update_study on public.feasibility_projects for update to authenticated
   using (private.feasibility_company_access(organization_id,true))
   with check (private.feasibility_company_access(organization_id,true));
 `);
 for(const org of [existing,paid,newPaid,excluded,legacy]){
  await query('insert into organizations(id,subscription_mode) values($1,$2)',[org,org===legacy?'legacy':'managed']);
  await query("insert into organization_members values($1,$2,'OWNER','ACTIVE')",[org,owner]);
 }
 await query("insert into organization_members values($1,$2,'VIEWER','ACTIVE')",[existing,viewer]);
 await query(`insert into platform_plans values($1,true,true,'["module:assets","module:liquidity"]',120)`,[plan]);
 await query(`insert into platform_plans values($1,true,true,'["module:assets","module:liquidity"]',80)`,[withoutPlan]);
 await query(`insert into platform_subscriptions(organization_id,status,trial_started_at,trial_ends_at,entitlements)
  values($1,'trialing',now()-interval '12 days',now()+interval '18 days','["core"]')`,[existing]);
 for(const org of [paid,excluded]){
  await query(`insert into platform_subscriptions(organization_id,status,plan_id,current_period_end,converted_at,entitlements,plan_snapshot)
   values($1,'active',$2,now()+interval '30 days',now(),'["module:assets","module:liquidity"]','{"price":120}')`,
   [org,org===excluded?withoutPlan:plan]);
 }
 const before=await query('select * from platform_subscriptions order by organization_id');
 const existingRow=(await query('select * from platform_subscriptions where organization_id=$1',[existing]))[0];
 await db.exec(await load(migrationPath));
 await check('migration preserves subscription snapshots, prices, dates and revisions',async()=>{
  assert.deepEqual(await query('select * from platform_subscriptions order by organization_id'),before);
  assert.equal(Number((await query('select price from platform_plans where id=$1',[plan]))[0].price),120);
 });
 await check('existing trial opens with its original deadline',async()=>{
  await actor(owner,async()=>{
   assert.equal((await workspace(existing)).canWrite,true);
   const grant=await access();
   assert.equal(grant.status,'TRIAL');
   assert.equal(grant.ends_at.toISOString(),existingRow.trial_ends_at.toISOString());
   await query('insert into feasibility_projects values($1,$2,$3,$4,1)',[id(30),existing,owner,'Existing trial study']);
  });
 });
 await check('new trial receives access automatically',async()=>{
  await query('insert into organizations(id) values($1)',[newcomer]);
  await query("insert into organization_members values($1,$2,'OWNER','ACTIVE')",[newcomer,owner]);
  await query(`insert into platform_subscriptions(organization_id,status,trial_started_at,trial_ends_at)
   values($1,'trialing',now(),now()+interval '30 days')`,[newcomer]);
  assert.equal((await actor(owner,()=>workspace(newcomer))).canWrite,true);
 });
 await check('published plan additions cover previous and new subscribers',async()=>{
  assert.equal((await actor(owner,()=>workspace(paid))).canWrite,false);
  await query(`update platform_plans set features=features||'["module:feasibility"]'::jsonb where id=$1`,[plan]);
  assert.equal((await actor(owner,()=>workspace(paid))).canWrite,true);
  await query(`insert into platform_subscriptions(organization_id,status,plan_id,current_period_end,converted_at,entitlements)
   values($1,'active',$2,now()+interval '30 days',now(),'["module:assets","module:liquidity"]')`,[newPaid,plan]);
  assert.equal((await actor(owner,()=>workspace(newPaid))).canWrite,true);
  assert.equal((await actor(owner,()=>workspace(excluded))).canWrite,false);
  assert.deepEqual(await query('select * from platform_subscriptions where organization_id=$1',[paid]),before.filter(r=>r.organization_id===paid));
 });
 await check('custom purchased bundles work and unrelated legacy accounts stay denied',async()=>{
  await query(`update platform_subscriptions set entitlements=entitlements||'["module:feasibility"]'::jsonb where organization_id=$1`,[excluded]);
  assert.equal((await actor(owner,()=>workspace(excluded))).canWrite,true);
  await query(`update platform_subscriptions set entitlements=entitlements-'module:feasibility' where organization_id=$1`,[excluded]);
  assert.equal((await actor(owner,()=>workspace(legacy))).canWrite,false);
 });
 await check('viewer, outsider and suspended membership cannot write',async()=>{
  await actor(viewer,async()=>{
   assert.equal((await workspace(existing)).canRead,true);
   assert.equal((await workspace(existing)).canWrite,false);
   assert.deepEqual(await query('update feasibility_projects set revision=2 where id=$1 returning id',[id(30)]),[]);
   await assert.rejects(query('insert into feasibility_projects values($1,$2,$3,$4,1)',[id(31),existing,viewer,'Denied']),{code:'42501'});
  });
  assert.equal((await actor(outsider,()=>workspace(existing))).canRead,false);
  await actor(outsider,async()=>assert.deepEqual(await query('select id from feasibility_projects'),[]));
  await query("update organization_members set status='SUSPENDED' where organization_id=$1 and user_id=$2",[existing,owner]);
  assert.equal((await actor(owner,()=>workspace(existing))).canWrite,false);
  await query("update organization_members set status='ACTIVE' where organization_id=$1 and user_id=$2",[existing,owner]);
 });
 await check('expired trials retain study data for reading and export and reject changes',async()=>{
  await query("update platform_subscriptions set trial_ends_at=now() where organization_id=$1",[existing]);
  await actor(owner,async()=>{
   assert.equal((await workspace(existing)).canRead,true);
   assert.equal((await workspace(existing)).canWrite,false);
   assert.deepEqual(await query('select title from feasibility_projects where organization_id=$1',[existing]),[{title:'Existing trial study'}]);
   assert.deepEqual(await query('update feasibility_projects set revision=2 where id=$1 returning id',[id(30)]),[]);
   await assert.rejects(query('insert into feasibility_projects values($1,$2,$3,$4,1)',[id(32),existing,owner,'Expired']),{code:'42501'});
  });
  await query("update platform_subscriptions set status='suspended' where organization_id=$1",[newcomer]);
  assert.equal((await actor(owner,()=>workspace(newcomer))).canWrite,false);
 });
 await check('expired paid plans retain read access without trial renewal',async()=>{
  await query("update platform_subscriptions set current_period_end=now()-interval '1 day' where organization_id=$1",[paid]);
  assert.equal((await actor(owner,()=>workspace(paid))).canRead,true);
  assert.equal((await actor(owner,()=>workspace(paid))).canWrite,false);
 });
 await check('personal admin restriction and company access stay separate',async()=>{
  await query("insert into feasibility_access_grants values($1,'READ_ONLY',now()-interval '1 day',null,'PLATFORM_ADMIN')",[owner]);
  assert.equal((await actor(owner,()=>access())).status,'READ_ONLY');
  assert.equal((await actor(owner,()=>workspace(newPaid))).canWrite,true);
 });
 if(process.env.WRITE_FEASIBILITY_TRIAL_SCHEMA_DELTA==='1'){
  const rows=await query(await load('tests/migration-history/catalog.sql'));
  await writeFile(new URL('../migration-history/feasibility-trial-schema-delta.json',import.meta.url),
   JSON.stringify({upserts:rows.filter(row=>['private.feasibility_effective_access(','private.feasibility_has_company_plan(','subscription_private.entitlement('].some(prefix=>row.object_key.startsWith(prefix))),removals:[]},null,2)+'\n');
 }
 console.log(JSON.stringify({checks:checks.length,hostedDatabasesAccessed:false,syntheticAccountsOnly:true}));
}finally{await db.close()}
