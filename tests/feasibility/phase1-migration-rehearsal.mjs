import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const modulePath=process.env.FEASIBILITY_PGLITE_MODULE;
assert(modulePath,'Set FEASIBILITY_PGLITE_MODULE to the installed @electric-sql/pglite 0.3.14 dist/index.js');
const {PGlite}=await import(pathToFileURL(modulePath).href);
const root=new URL('../../',import.meta.url);
const file=path=>readFile(new URL(path,root),'utf8');
const apply=await file('supabase/migrations/20261116164057_feasibility_phase1_foundation.sql');
const organizationPolicies=await file('supabase/migrations/20260922213001_fix_organization_rls_recursion.sql');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const user={owner:id(1),admin:id(2),viewer:id(3),other:id(4),expired:id(5),suspended:id(6),noGrant:id(7)};
const org=id(11), otherOrg=id(12), personal=id(21), company=id(22), outside=id(23);
let db=await PGlite.create();
const query=(sql,args=[])=>db.query(sql,args);
const exec=sql=>db.exec(sql);
const rows=async(sql,args=[]) => (await query(sql,args)).rows;
const visible=async()=> (await rows('select id from public.feasibility_projects order by id')).map(r=>r.id);
const actor=async(id,fn,role='authenticated')=>{
 await query("select set_config('request.jwt.claim.sub',$1,false)",[id??'']);
 await exec('set role '+role);
 try {return await fn()} finally {await exec('reset role');await query("select set_config('request.jwt.claim.sub','',false)");}
};
const reject=(fn,code)=>assert.rejects(fn,e=>e.code===code);
const insert=(project,owner,organization,title)=>query(`
 insert into public.feasibility_projects(id,owner_user_id,organization_id,title,study)
 values ($1,$2,$3,$4,jsonb_build_object('id',$1::uuid::text,'title',$4::text,'water',jsonb_build_object('capex',24680)))
 returning revision`,[project,owner,organization,title]);
const customerSlice=()=>rows(`
 select
   (select jsonb_agg(to_jsonb(o) order by o.id) from public.organizations o) as organizations,
   (select jsonb_agg(to_jsonb(m) order by m.organization_id,m.user_id) from public.organization_members m) as members,
   (select jsonb_agg(to_jsonb(u) order by u.id) from auth.users u) as users`);
const catalog=()=>rows(`
 select schemaname,tablename,rowsecurity
 from pg_tables
 where (schemaname='public' or schemaname='private') and tablename like 'feasibility_%'
 order by 1,2`);
async function restore(backup){
 const bytes=Buffer.from(await backup.arrayBuffer());
 const checksum=createHash('sha256').update(bytes).digest('hex');
 await db.close();
 db=await PGlite.create({loadDataDir:new Blob([bytes])});
 return {bytes:bytes.length,checksum};
}
try{
 await exec(`
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create schema private;
  grant usage on schema auth,private to authenticated,anon,service_role;
  create table auth.users(id uuid primary key);
  create function auth.uid() returns uuid language sql stable as
   $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  create table public.organizations(
   id uuid primary key,owner_user_id uuid not null references auth.users(id),status text not null
  );
  create table public.organization_members(
   organization_id uuid references public.organizations(id),user_id uuid references auth.users(id),
   role text not null,status text not null,primary key(organization_id,user_id)
  );
  alter table public.organizations enable row level security;
  alter table public.organization_members enable row level security;
  grant select on public.organizations,public.organization_members to authenticated;
 `);
 await exec(organizationPolicies);
 for(const u of Object.values(user)) await query('insert into auth.users values ($1)',[u]);
 await query("insert into public.organizations values ($1,$2,'ACTIVE'),($3,$4,'ACTIVE')",[org,user.owner,otherOrg,user.other]);
 for(const [organization,u,role,status] of [
  [org,user.owner,'OWNER','ACTIVE'],[org,user.admin,'ADMIN','ACTIVE'],[org,user.viewer,'VIEWER','ACTIVE'],
  [org,user.expired,'ADMIN','ACTIVE'],[org,user.suspended,'ADMIN','SUSPENDED'],[org,user.noGrant,'VIEWER','ACTIVE'],
  [otherOrg,user.other,'OWNER','ACTIVE']
 ]) await query('insert into public.organization_members values ($1,$2,$3,$4)',[organization,u,role,status]);

 const baseline=await customerSlice();
 assert.deepEqual(await catalog(),[]);
 const before=await db.dumpDataDir('gzip');
 await exec(apply);
 assert.deepEqual(await customerSlice(),baseline,'Migration must preserve all prerequisite rows');
 assert.equal((await catalog()).filter(x=>x.schemaname==='public'&&x.rowsecurity).length,3);
 assert.equal((await rows('select enabled from private.feasibility_org_feature_switch'))[0].enabled,false);
 assert.deepEqual(await rows('select * from public.feasibility_access_grants'),[]);
 const sharingAbsent=await rows(`
  select to_regclass('public.feasibility_project_invitations') is null
   and to_regclass('public.feasibility_project_members') is null
   and not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname like 'feasibility_%') as ok`);
 assert.equal(sharingAbsent[0].ok,true);
 for(const u of Object.values(user).filter(u=>u!==user.noGrant)){
  await query(`insert into public.feasibility_access_grants(user_id,status,starts_at,ends_at)
   values ($1,'ACTIVE',now()-interval '4 days',case when $2 then now()-interval '1 day' else null end)`,[u,u===user.expired]);
 }

 await actor(null,()=>reject(()=>visible(),'42501'),'anon');
 await actor(user.owner,async()=>{
  await reject(()=>insert(company,null,org,'Company'),'42501');
  await reject(()=>query('update private.feasibility_org_feature_switch set enabled=true'),'42501');
  await reject(()=>query('delete from public.feasibility_access_grants'),'42501');
  await reject(()=>query("insert into public.feasibility_projects(id,owner_user_id,title,study) values ($1,$2,'Missing JSON fields','{}')",[personal,user.owner]),'23514');
  assert.equal((await insert(personal,user.owner,null,'Personal')).rows[0].revision,1);
  assert.deepEqual(await visible(),[personal]);
  assert.deepEqual((await rows('select user_id from public.feasibility_access_grants')).map(r=>r.user_id),[user.owner]);
  await reject(()=>query("update public.feasibility_projects set organization_id=$1 where id=$2",[org,personal]),'42501');
  await reject(()=>query("update public.feasibility_projects set study=study where id=$1",[personal]),'23514');
  assert.equal((await query('update public.feasibility_projects set revision=2 where id=$1 and revision=1 returning revision',[personal])).rows[0].revision,2);
  assert.deepEqual(await rows('update public.feasibility_projects set revision=2 where id=$1 and revision=1 returning revision',[personal]),[]);
  await reject(()=>query('insert into public.feasibility_review_snapshots(project_id,source_revision) values($1,1)',[personal]),'23514');
  assert.equal((await rows('insert into public.feasibility_review_snapshots(project_id,source_revision) values($1,2) returning study_snapshot',[personal]))[0].study_snapshot.id,personal);
  await reject(()=>query('update public.feasibility_review_snapshots set notes=$1',['replacement']),'42501');
  await reject(()=>query('delete from public.feasibility_projects where id=$1',[personal]),'23503');
  const scratch=id(24);
  await insert(scratch,user.owner,null,'Unreviewed');
  assert.equal((await query('delete from public.feasibility_projects where id=$1 returning id',[scratch])).rows[0].id,scratch);
  await reject(()=>query('select * from private.feasibility_project_audit'),'42501');
 });

 await exec('update private.feasibility_org_feature_switch set enabled=true');
 await actor(user.owner,async()=>{
  assert.equal((await insert(company,null,org,'Company')).rows[0].revision,1);
  await reject(()=>insert(outside,null,otherOrg,'Other company'),'42501');
  assert.deepEqual(await rows('delete from public.feasibility_projects where id=$1 returning id',[company]),[]);
  await reject(()=>query('insert into public.feasibility_review_snapshots(project_id,source_revision) values($1,1)',[company]),'42501');
 });
 await actor(user.admin,async()=>{
  assert.deepEqual(await visible(),[company]);
  assert.equal((await rows('update public.feasibility_projects set revision=2 where id=$1 and revision=1 returning revision',[company]))[0].revision,2);
  assert.deepEqual(await rows('delete from public.feasibility_projects where id=$1 returning id',[company]),[]);
 });
 for(const u of [user.viewer,user.expired]){
  await actor(u,async()=>{
   assert.deepEqual(await visible(),[company]);
   assert.deepEqual(await rows('update public.feasibility_projects set revision=3 where id=$1 returning revision',[company]),[]);
   await reject(()=>insert(outside,null,org,'Forbidden'),'42501');
  });
 }
 for(const u of [user.other,user.suspended,user.noGrant]) await actor(u,async()=>assert.deepEqual(await visible(),[]));
 await exec("update public.organizations set status='INACTIVE' where id='"+org+"'");
 await actor(user.owner,async()=>assert.deepEqual(await visible(),[personal]));
 await exec("update public.organizations set status='ACTIVE' where id='"+org+"'");
 await exec("update public.feasibility_access_grants set status='READ_ONLY' where user_id='"+user.owner+"'");
 await actor(user.owner,async()=>{
  assert.deepEqual(await visible(),[personal,company]);
  assert.deepEqual(await rows('update public.feasibility_projects set revision=3 where id=$1 returning revision',[personal]),[]);
 });
 await exec('update private.feasibility_org_feature_switch set enabled=false');
 await actor(user.owner,async()=>assert.deepEqual(await visible(),[personal]));
 assert.deepEqual(await customerSlice(),baseline);
 const persisted=await rows('select id,revision,study from public.feasibility_projects order by id');
 const audit=await rows('select event,revision from private.feasibility_project_audit order by id');
 assert.deepEqual(audit.map(a=>a.event),['INSERT','UPDATE','INSERT','DELETE','INSERT','UPDATE']);
 const phaseBackup=await db.dumpDataDir('gzip');
 const after=await restore(phaseBackup);
 assert.deepEqual(await customerSlice(),baseline);
 assert.deepEqual(await rows('select id,revision,study from public.feasibility_projects order by id'),persisted);
 assert.deepEqual(await rows('select event,revision from private.feasibility_project_audit order by id'),audit);
 await actor(user.owner,async()=>assert.deepEqual(await visible(),[personal]));

 const rollback=await restore(before);
 assert.deepEqual(await customerSlice(),baseline,'Restoring the pre-change backup must preserve all prerequisites');
 assert.deepEqual(await catalog(),[],'Restoring the pre-change backup must leave no feasibility objects');
 await exec(apply);
 assert.deepEqual(await customerSlice(),baseline);
 assert.equal((await rows('select enabled from private.feasibility_org_feature_switch'))[0].enabled,false);
 console.log(JSON.stringify({migration:'PASS',rls:'PASS',audit:'PASS',beforeRestore:rollback,afterRestore:after},null,2));
}finally{await db.close();}
