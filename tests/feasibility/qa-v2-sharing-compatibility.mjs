import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const modulePath=process.env.FEASIBILITY_PGLITE_MODULE;
assert(modulePath,'Set FEASIBILITY_PGLITE_MODULE to the installed PGlite module');
const {PGlite}=await import(pathToFileURL(modulePath).href);
const read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
const bridge=await read('docs/feasibility/qa-v2-sharing-compatibility.sql');
const workspaceBridge=await read('docs/feasibility/qa-v2-sharing-compatibility-workspace.sql');
const migration=await read('supabase/migrations/20261116194423_feasibility_organization_sharing.sql');
assert.match(migration,/^begin;\n/);
assert.match(migration,/commit;\s*$/);
const apply=migration.replace(/^begin;\n/,()=> 'begin;\n'+bridge+'\n')
 .replace(/commit;\s*$/,()=>workspaceBridge+'\ncommit;');
const db=await PGlite.create();
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const [owner,recipient,outsider,source,destination,study,legacyOwnerA,legacyOwnerB,legacyOrgA,legacyOrgB,legacyStudyA,legacyStudyB,lateStudy]=
 Array.from({length:13},(_,i)=>id(i+1));
const query=async(sql,args=[]) => (await db.query(sql,args)).rows;
const rpc=(action,org,project=study,receiver=null,revision=null,days=null)=>
 query('select public.feasibility_company_shares($1,$2,$3,$4,$5,$6) as result',[action,org,project,receiver,revision,days])
  .then(rows=>rows[0].result);
const actor=async(user,fn)=>{
 await query("select set_config('request.jwt.claim.sub',$1,false)",[user]);
 await db.exec('set role authenticated');
 try{return await fn()}finally{await db.exec('reset role')}
};

try{
 // Reproduce the catalog contract observed on QA V2. Plans use synthetic entitlement fixtures.
 await db.exec(`
  create role authenticated;
  create role anon;
  create role service_role;
  create schema auth;
  create schema private;
  create schema subscription_private;
  grant usage on schema auth,private to authenticated;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as
   $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  create table public.organizations (id uuid primary key, name text not null, status text not null);
  create table public.organization_members (organization_id uuid, user_id uuid, role text, status text);
  create table public.platform_audit_events (actor_user_id uuid, event_type text, entity_type text, entity_id uuid, details jsonb);
  create table subscription_private.plans (organization_id uuid primary key, entitlement jsonb not null);
  create function subscription_private.entitlement(p_organization uuid) returns jsonb language sql stable as
   $$ select entitlement from subscription_private.plans where organization_id=p_organization $$;
  create table private.feasibility_org_feature_switch (id boolean primary key, enabled boolean not null);
  insert into private.feasibility_org_feature_switch values (true,true);
  create function private.feasibility_org_enabled() returns boolean language sql stable security definer as
   $$ select enabled from private.feasibility_org_feature_switch where id=true $$;
  create table public.feasibility_access_grants (user_id uuid primary key, starts_at timestamptz not null);
  grant select on public.organization_members,public.organizations,public.feasibility_access_grants to authenticated;
  create table public.feasibility_projects (id uuid primary key, organization_id uuid, created_by_user_id uuid, owner_user_id uuid, revision int, title text, study jsonb);
  alter table public.feasibility_projects enable row level security;
  grant select,insert,update,delete on public.feasibility_projects to authenticated;
  create policy feasibility_org_read on public.feasibility_projects for select to authenticated using (
   private.feasibility_org_enabled() and organization_id is not null and owner_user_id is null
   and exists(select 1 from public.organizations o where o.id=organization_id and o.status='ACTIVE')
   and exists(select 1 from public.organization_members m where m.organization_id=feasibility_projects.organization_id
    and m.user_id=auth.uid() and m.status='ACTIVE')
   and exists(select 1 from public.feasibility_access_grants g where g.user_id=auth.uid() and g.starts_at<=now())
  );
  create policy feasibility_org_insert on public.feasibility_projects for insert to authenticated with check (private.feasibility_org_enabled());
  create policy feasibility_org_update on public.feasibility_projects for update to authenticated using (private.feasibility_org_enabled());
  create policy feasibility_org_delete on public.feasibility_projects for delete to authenticated using (private.feasibility_org_enabled());
 `);
 await query('insert into auth.users values ($1),($2),($3)',[owner,recipient,outsider]);
 await query("insert into organizations values ($1,'Source','ACTIVE'),($2,'Destination','ACTIVE')",[source,destination]);
 await query("insert into organization_members values ($1,$2,'OWNER','ACTIVE'),($3,$4,'OWNER','ACTIVE')",[source,owner,destination,recipient]);
 await query('insert into subscription_private.plans values ($1,$2)',[source,{status:'active',capabilities:['module:feasibility']}]);
 await query("insert into feasibility_projects values ($1,$2,$3,null,1,'Water study',jsonb_build_object('amount',50))",[study,source,owner]);
 await query('insert into auth.users values ($1),($2)',[legacyOwnerA,legacyOwnerB]);
 await query("insert into organizations values ($1,'Legacy A','ACTIVE'),($2,'Legacy B','ACTIVE')",[legacyOrgA,legacyOrgB]);
 await query("insert into organization_members values ($1,$2,'OWNER','ACTIVE'),($3,$4,'OWNER','ACTIVE')",[legacyOrgA,legacyOwnerA,legacyOrgB,legacyOwnerB]);
 await query('insert into feasibility_access_grants values ($1,now()),($2,now()),($3,now())',[legacyOwnerA,legacyOwnerB,outsider]);
 await query("insert into feasibility_projects values ($1,$2,$3,null,1,'Legacy A study','{}'),($4,$5,$6,null,1,'Legacy B study','{}')",
  [legacyStudyA,legacyOrgA,legacyOwnerA,legacyStudyB,legacyOrgB,legacyOwnerB]);
 const before=await query('select * from feasibility_projects order by id');
 assert.deepEqual(await actor(legacyOwnerA,()=>query('select id from feasibility_projects')),[{id:legacyStudyA}]);
 assert.deepEqual(await actor(legacyOwnerB,()=>query('select id from feasibility_projects')),[{id:legacyStudyB}]);
 await db.exec(apply);
 assert.deepEqual(await query('select * from feasibility_projects order by id'),before);
 const workspace=async organization=>(await query('select public.feasibility_company_workspace($1) as scope',[organization]))[0].scope;
 const access={canRead:true,canWrite:false,canShare:false};
 assert.deepEqual(await actor(legacyOwnerA,()=>workspace(legacyOrgA)),access);
 assert.deepEqual(await actor(legacyOwnerB,()=>workspace(legacyOrgB)),access);
 await actor(legacyOwnerA,async()=>{
  assert.deepEqual(await query('select id from feasibility_projects order by id'),[{id:legacyStudyA}]);
  assert.deepEqual(await query('update feasibility_projects set revision=2 where id=$1 returning id',[legacyStudyA]),[]);
  assert.deepEqual(await query('delete from feasibility_projects where id=$1 returning id',[legacyStudyA]),[]);
  await assert.rejects(rpc('share',legacyOrgA,legacyStudyA,destination,1,1),{code:'42501'});
  assert.equal((await workspace(legacyOrgB)).canRead,false);
 });
 assert.equal((await actor(outsider,()=>workspace(legacyOrgA))).canRead,false);
 await query('delete from feasibility_access_grants where user_id=$1',[legacyOwnerB]);
 assert.equal((await actor(legacyOwnerB,()=>workspace(legacyOrgB))).canRead,false);
 await query('insert into feasibility_access_grants values ($1,now())',[legacyOwnerB]);
 await query("insert into feasibility_projects values ($1,$2,$3,null,1,'Entered later','{}')",[lateStudy,legacyOrgA,legacyOwnerA]);
 assert.deepEqual(await actor(legacyOwnerA,()=>query('select id from feasibility_projects order by id')),[{id:legacyStudyA}]);
 assert.deepEqual(await query('select enabled from private.feasibility_org_feature_switch'),[{enabled:true}]);
 await actor(owner,async()=>{
  assert.deepEqual(await workspace(source),{canRead:true,canWrite:true,canShare:true});
  assert.deepEqual(await query('delete from feasibility_projects where id=$1 returning id',[study]),[]);
  await assert.rejects(rpc('share',source,study,destination,1,31),/FEASIBILITY_NON_SUBSCRIBER_MAX_30_DAYS/);
  await rpc('share',source,study,destination,1,30);
  await query('update feasibility_projects set study=$1,revision=2 where id=$2',[{amount:100},study]);
 });
 await actor(recipient,async()=>{
  assert.deepEqual((await rpc('open',destination)).study,{amount:50});
  assert.deepEqual(await query('select id from feasibility_projects where id=$1',[study]),[]);
  assert.deepEqual(await query('update feasibility_projects set revision=3 where id=$1 returning id',[study]),[]);
 });
 await actor(outsider,()=>assert.rejects(rpc('open',destination),{code:'42501'}));
 await actor(owner,()=>rpc('revoke',source,study,destination));
 await actor(recipient,async()=>assert.equal(await rpc('open',destination),null));
 await query("update private.feasibility_organization_shares set first_shared_at=now()-interval '31 days',expires_at=now()-interval '1 day' where project_id=$1",[study]);
 await actor(owner,()=>assert.rejects(rpc('share',source,study,destination,2,1),/FEASIBILITY_NON_SUBSCRIBER_MAX_30_DAYS/));
 await db.exec('update private.feasibility_org_feature_switch set enabled=false');
 await actor(recipient,()=>assert.rejects(rpc('open',destination),{code:'42501'}));
 assert.deepEqual(await actor(legacyOwnerA,()=>query('select id from feasibility_projects')),[]);
 await assert.rejects(db.exec(apply),/UNEXPECTED_QA_V2_FEASIBILITY_SCHEMA/);
 await db.exec('rollback');
 console.log('PASS QA V2 switch bridge, isolated paid fixture, preserved legacy reads, DELETE denial, immutable snapshot, 30-day cap, revocation and tenant isolation');
}finally{await db.close()}
