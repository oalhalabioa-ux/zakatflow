import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const modulePath=process.env.FEASIBILITY_PGLITE_MODULE;
assert(modulePath,'Set FEASIBILITY_PGLITE_MODULE to the installed PGlite module');
const {PGlite}=await import(pathToFileURL(modulePath).href);
const db=await PGlite.create();
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const [owner,admin,member,outsider,source,destination,other,study,legacyStudy]=
 Array.from({length:9},(_,i)=>id(i+1));
const query=async(sql,args=[]) => (await db.query(sql,args)).rows;
const asUser=async(user,fn)=>{
 await query("select set_config('request.jwt.claim.sub',$1,false)",[user]);
 await db.exec('set role authenticated');
 try{return await fn()}finally{await db.exec('reset role')}
};
const invite=async(action,org,invitation=null,project=null,recipient=null,revision=null,days=null,access=null)=>
 (await query('select public.feasibility_company_invitations($1,$2,$3,$4,$5,$6,$7,$8) as result',
  [action,org,invitation,project,recipient,revision,days,access]))[0].result;
const original=async(action,org,project=null,recipient=null,revision=null,days=null)=>
 (await query('select public.feasibility_company_shares($1,$2,$3,$4,$5,$6) as result',
  [action,org,project,recipient,revision,days]))[0].result;
const issue=(revision=1,days=30,access='read')=>
 asUser(owner,()=>invite('issue',source,null,study,destination,revision,days,access));
const decide=(action,invitation)=>asUser(admin,()=>invite(action,destination,invitation));

try{
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
  create table public.platform_admins (user_id uuid primary key, role text not null);
  create table public.profiles (id uuid primary key, name text not null, locale text not null);
  create table public.notifications (user_id uuid, type text, title text, body text, scheduled_for timestamptz, metadata jsonb);
  create table public.platform_audit_events (
   id uuid primary key default gen_random_uuid(), actor_user_id uuid, event_type text,
   entity_type text, entity_id uuid, details jsonb, created_at timestamptz not null default now()
  );
  create table subscription_private.plans (organization_id uuid primary key, entitlement jsonb not null);
  create function subscription_private.entitlement(p_organization uuid) returns jsonb language sql stable as
   $$ select entitlement from subscription_private.plans where organization_id=p_organization $$;


  create function private.feasibility_phase1_org_enabled() returns boolean language sql stable security definer as
   $$ select true $$;
  create table public.feasibility_access_grants (user_id uuid primary key, starts_at timestamptz not null);
  grant select on public.organization_members,public.organizations,public.feasibility_access_grants to authenticated;
  create table public.feasibility_projects (id uuid primary key, organization_id uuid, created_by_user_id uuid, owner_user_id uuid, revision int, title text, study jsonb);
  alter table public.feasibility_projects enable row level security;
  grant select,insert,update,delete on public.feasibility_projects to authenticated;
  create policy feasibility_org_read on public.feasibility_projects for select to authenticated using (
   private.feasibility_phase1_org_enabled() and organization_id is not null and owner_user_id is null
   and exists(select 1 from public.organizations o where o.id=organization_id and o.status='ACTIVE')
   and exists(select 1 from public.organization_members m where m.organization_id=feasibility_projects.organization_id
    and m.user_id=auth.uid() and m.status='ACTIVE')
   and exists(select 1 from public.feasibility_access_grants g where g.user_id=auth.uid() and g.starts_at<=now())
  );
  create policy feasibility_org_insert on public.feasibility_projects for insert to authenticated with check (private.feasibility_phase1_org_enabled());
  create policy feasibility_org_update on public.feasibility_projects for update to authenticated using (private.feasibility_phase1_org_enabled());
  create policy feasibility_org_delete on public.feasibility_projects for delete to authenticated using (private.feasibility_phase1_org_enabled());
 `);
 await query('insert into auth.users values ($1),($2),($3),($4)',[owner,admin,member,outsider]);
 await query("insert into organizations values ($1,'Source','ACTIVE'),($2,'Recipient','ACTIVE'),($3,'Other','ACTIVE')",[source,destination,other]);
 await query("insert into organization_members values ($1,$2,'OWNER','ACTIVE'),($3,$4,'ADMIN','ACTIVE'),($3,$5,'MEMBER','ACTIVE'),($6,$7,'OWNER','ACTIVE')",
  [source,owner,destination,admin,member,other,outsider]);
 await query("insert into profiles values ($1,'Reviewer','ar'),($2,'Member','en'),($3,'Other','en')",[admin,member,outsider]);
 await query('insert into subscription_private.plans values ($1,$2)',[source,{status:'active',capabilities:['module:feasibility']}]);
 await query("insert into feasibility_projects values ($1,$2,$3,null,1,'Private study',jsonb_build_object('amount',50)),($4,$2,$3,null,1,'Legacy study','{}')",
  [study,source,owner,legacyStudy]);
 for(const path of [
  'supabase/migrations/20261116194423_feasibility_organization_sharing.sql',
  'supabase/migrations/20261117024046_feasibility_sharing_permissions.sql',
  'supabase/migrations/20261117064000_feasibility_share_proposals.sql',
  'docs/feasibility/qa-company-invitations.sql',
 ]){
  if(path.startsWith('docs/')){
   await asUser(owner,()=>original('share',source,legacyStudy,destination,1,10));
  }
  await db.exec(await readFile(new URL('../../'+path,import.meta.url),'utf8'));
 }
 await assert.rejects(issue(),{code:'42501',message:'FEASIBILITY_COMPANY_INVITATION_DISABLED'});
 await db.exec('update private.feasibility_sharing_policy set company_invitations_enabled=true');
 await asUser(owner,()=>assert.rejects(original('share',source,study,destination,1,30),
  {code:'42501',message:'FEASIBILITY_COMPANY_INVITATION_REQUIRED'}));
 const directory=()=>asUser(owner,()=>invite('directory_search',source,null,null,null,null,null,'rec'));
 assert.deepEqual(await directory(),[]);
 await asUser(admin,()=>assert.rejects(invite('directory_enable',destination),{code:'42501'}));
 await asUser(outsider,()=>invite('directory_enable',other));
 const recipientOwner=id(10);
 await query('insert into auth.users values ($1)',[recipientOwner]);
 await query("insert into organization_members values ($1,$2,'OWNER','ACTIVE')",[destination,recipientOwner]);
 await asUser(recipientOwner,()=>invite('directory_enable',destination));
 assert.deepEqual(await directory(),[{id:destination,name:'Recipient'}]);
 await asUser(recipientOwner,()=>invite('directory_disable',destination));
 assert.deepEqual(await directory(),[]);
 await assert.rejects(issue(1,31),{code:'22023',message:'FEASIBILITY_NON_SUBSCRIBER_MAX_30_DAYS'});
 const pending=await issue();
 assert.deepEqual(await issue(),pending);
 const inbox=await asUser(admin,()=>invite('inbox',destination));
 assert.equal(inbox.length,1);
 assert.deepEqual(Object.keys(inbox[0]).sort(),['access_mode','days','expires_at','id','issued_at','source_name','state']);
 assert.deepEqual(await asUser(admin,()=>original('inbox',destination)).then(rows=>rows.map(row=>row.project_id)),[legacyStudy]);
 assert.equal(await asUser(admin,()=>original('open',destination,study)),null);
 assert.deepEqual(await asUser(admin,()=>query('select id from feasibility_projects where id=$1',[study])),[]);
 await asUser(member,()=>assert.rejects(invite('accept',destination,pending.id),{code:'42501'}));
 await asUser(outsider,()=>assert.rejects(invite('accept',other,pending.id),{code:'42501'}));
 const notices=await query('select user_id,body,metadata from notifications');
 assert.deepEqual(notices,[{user_id:admin,body:'Source',metadata:{organization:destination,invitation:pending.id}}]);

 await query("update private.feasibility_company_invitations set issued_at=clock_timestamp()-interval '2 days' where id=$1",[pending.id]);
 assert.equal((await decide('accept',pending.id)).state,'accepted');
 assert.equal((await decide('accept',pending.id)).state,'accepted');
 await assert.rejects(decide('decline',pending.id),{code:'40001'});
 assert.equal((await asUser(admin,()=>original('open',destination,study))).study.amount,50);
 const [grant]=await query("select (s.expires_at-s.first_shared_at)=interval '720 hours' as thirty_days, first_shared_at>i.issued_at as starts_on_acceptance from private.feasibility_organization_shares s join private.feasibility_company_invitations i on i.id=s.company_invitation_id where s.project_id=$1",[study]);
 assert.deepEqual(grant,{thirty_days:true,starts_on_acceptance:true});
 assert.equal((await decide('revoke',pending.id)).state,'revoked');
 assert.equal(await asUser(admin,()=>original('open',destination,study)),null);

 await query('update feasibility_projects set revision=2 where id=$1',[study]);
 const stale=await issue(2,3);
 await query('update feasibility_projects set revision=3 where id=$1',[study]);
 await assert.rejects(decide('accept',stale.id),{code:'40001',message:'FEASIBILITY_STALE_SHARE_REVISION'});
 assert.equal((await asUser(owner,()=>invite('withdraw',source,stale.id))).state,'withdrawn');
 const declined=await issue(3,3);
 assert.equal((await decide('decline',declined.id)).state,'declined');
 await assert.rejects(decide('accept',declined.id),{code:'40001'});

 const expired=await issue(3,3);
 await query("update private.feasibility_company_invitations set issued_at=now()-interval '8 days',expires_at=now()-interval '1 day' where id=$1",[expired.id]);
 assert.equal((await decide('accept',expired.id)).state,'expired');
 assert.equal(await asUser(admin,()=>original('open',destination,study)),null);
 await query('insert into subscription_private.plans values ($1,$2)',[destination,{status:'active',capabilities:['module:feasibility']}]);
 await db.exec("update private.feasibility_sharing_policy set mode='edit'");
 const editing=await issue(3,10,'edit');
 await db.exec("update private.feasibility_sharing_policy set mode='read'");
 await assert.rejects(decide('accept',editing.id),{code:'42501',message:'FEASIBILITY_SHARE_EDIT_FORBIDDEN'});
 await db.exec("update private.feasibility_sharing_policy set mode='edit'");
 assert.equal((await decide('accept',editing.id)).state,'accepted');
 const editable=await asUser(admin,async()=>(await query(
  "select public.feasibility_company_shares_access('open',$1,$2) as result",[destination,study]))[0].result);
 assert.equal(editable.can_edit,true);
 await asUser(owner,()=>original('revoke',source,study,destination));
 await assert.rejects(decide('accept',editing.id),{code:'40001'});
 assert.equal(await asUser(admin,()=>original('open',destination,study)),null);
 const events=await query("select event_type,actor_user_id from platform_audit_events where entity_id=$1 order by created_at",[pending.id]);
 assert.deepEqual(events,[
  {event_type:'feasibility.company_invitation_issued',actor_user_id:owner},
  {event_type:'feasibility.company_invitation_accepted',actor_user_id:admin},
  {event_type:'feasibility.company_invitation_revoked',actor_user_id:admin},
 ]);
 console.log('Company invitation lifecycle, authorization, privacy, legacy grants, and audit passed');
}finally{
 await db.close();
}
