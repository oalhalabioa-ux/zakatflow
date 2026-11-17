import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
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
 const catalog=await read('tests/migration-history/catalog.sql');
 const beforePermissions=await query(catalog);
 await db.exec(await read('supabase/migrations/20261117024046_feasibility_sharing_permissions.sql'));
 const afterPermissions=await query(catalog);
 const index=new Map(beforePermissions.map(entry=>[entry.category+entry.object_key,entry.fingerprint]));
 const delta=afterPermissions.filter(entry=>index.get(entry.category+entry.object_key)!==entry.fingerprint);
 const expected=JSON.parse(await read('tests/migration-history/feasibility-sharing-permissions-schema-delta.json'));
 assert.deepEqual(delta,expected.upserts);
 const shareAccess=(action,org,receiver=null,revision=null,days=null,access=null,patch=null)=>
  query('select public.feasibility_company_shares_access($1,$2,$3,$4,$5,$6,$7,$8) as result',
   [action,org,study,receiver,revision,days,access,patch===null?null:JSON.stringify(patch)])
    .then(rows=>rows[0].result);
 const mode=async(value=null)=>(await query('select public.feasibility_manage_sharing($1) as mode',[value]))[0].mode;
 await query("insert into platform_admins values ($1,'platform_owner')",[outsider]);
 await actor(owner,async()=>{
  assert.equal(await mode(),'read');
  await assert.rejects(mode('edit'),{code:'42501'});
  await assert.rejects(shareAccess('share',source,destination,2,1,'edit'),{code:'42501'});
 });
 await actor(outsider,()=>mode('edit'));
 await actor(owner,()=>assert.rejects(shareAccess('share',source,destination,2,1,'edit'),{code:'42501'}));
 await query('insert into subscription_private.plans values ($1,$2)',[destination,{status:'active',capabilities:['module:feasibility']}]);
 await actor(owner,()=>shareAccess('share',source,destination,2,3,'edit'));
 await actor(recipient,async()=>{
  const shared=await shareAccess('open',destination);
  assert.equal(shared.can_edit,true);
  await assert.rejects(shareAccess('edit',destination,null,shared.shared_revision,null,null,{organization_id:source}),{code:'22023'});
  const edited=await shareAccess('edit',destination,null,shared.shared_revision,null,null,{title:'Collaborated',notes:'Reviewed',unitPrice:95});
  assert.equal(edited.shared_revision,shared.shared_revision+1);
  assert.equal(edited.study.title,'Collaborated');
  assert.equal(edited.study.unitPrice,95);
  await assert.rejects(shareAccess('edit',destination,null,shared.shared_revision,null,null,{notes:'Stale'}),{code:'40001'});
 });
 assert.equal((await query('select title from feasibility_projects where id=$1',[study]))[0].title,'Water study');
 await actor(owner,()=>shareAccess('share',source,destination,2,3,'read'));
 await actor(recipient,async()=>{
  const shared=await shareAccess('open',destination);
  assert.equal(shared.can_edit,false);
  assert.equal(shared.study.title,'Collaborated');
  await assert.rejects(shareAccess('edit',destination,null,shared.shared_revision,null,null,{notes:'No'}),{code:'42501'});
 });
 await actor(owner,()=>shareAccess('share',source,destination,2,3,'edit'));
 await query("update subscription_private.plans set entitlement=entitlement||'{\"status\":\"expired\"}'::jsonb where organization_id=$1",[destination]);
 await actor(recipient,()=>assert.rejects(shareAccess('edit',destination,null,3,null,null,{notes:'Expired plan'}),{code:'42501'}));
 await query("update subscription_private.plans set entitlement=entitlement||'{\"status\":\"active\"}'::jsonb where organization_id=$1",[destination]);
 await query("update private.feasibility_organization_shares set expires_at=now()-interval '1 day' where project_id=$1",[study]);
 await actor(recipient,()=>assert.rejects(shareAccess('edit',destination,null,3,null,null,{notes:'Expired share'}),{code:'42501'}));
 await query("update private.feasibility_organization_shares set expires_at=now()+interval '1 day' where project_id=$1",[study]);
 await query('insert into organization_members values ($1,$2,$3,$4)',[destination,outsider,'VIEWER','ACTIVE']);
 await actor(outsider,async()=>{
  assert.equal((await shareAccess('open',destination)).can_edit,false);
  await assert.rejects(shareAccess('edit',destination,null,1,null,null,{notes:'No'}),{code:'42501'});
  assert.equal(await mode('read'),'read');
 });
 await actor(recipient,async()=>{
  assert.equal((await shareAccess('open',destination)).can_edit,false);
  await assert.rejects(shareAccess('edit',destination,null,1,null,null,{notes:'No'}),{code:'42501'});
 });
 await actor(outsider,()=>mode('disabled'));
 await actor(recipient,()=>assert.rejects(rpc('open',destination),{code:'42501'}));
 await actor(owner,async()=>{
  await assert.rejects(rpc('share',source,study,destination,2,2),{code:'42501'});
  await assert.rejects(query('select private.feasibility_company_shares($1,$2,$3,$4,$5,$6)',
   ['share',source,study,destination,2,2]),{code:'42501'});
  await rpc('revoke',source,study,destination);
 });
 await actor(outsider,()=>mode('edit'));
 await actor(recipient,async()=>assert.equal(await shareAccess('open',destination),null));
 assert.equal((await query("select count(*)::int count from platform_audit_events where event_type='feasibility.organization_sharing_policy'"))[0].count,4);
 console.log('PASS administrator policy, recipient snapshot edits, optimistic revision, role isolation and backward-compatible enforcement');
 const beforeProposals=await query(catalog);
 await db.exec(await read('supabase/migrations/20261117064000_feasibility_share_proposals.sql'));
 const afterProposals=await query(catalog);
 const proposalCatalog=new Map(beforeProposals.map(entry=>[entry.category+entry.object_key,entry.fingerprint]));
 const proposalDelta={description:'Organization study edit proposals, review decisions and historical snapshots',
  upserts:afterProposals.filter(entry=>proposalCatalog.get(entry.category+entry.object_key)!==entry.fingerprint),removals:[]};
 const deltaPath='tests/migration-history/feasibility-share-proposals-schema-delta.json';
 if(process.argv.includes('--write-proposal-delta')) await writeFile(new URL('../../'+deltaPath,import.meta.url),JSON.stringify(proposalDelta,null,2)+'\n');
 else assert.deepEqual(proposalDelta,JSON.parse(await read(deltaPath)));

 const proposal=(action,org,proposalId=null,revision=null,choices=null,reason=null)=>
  query('select public.feasibility_share_proposal($1,$2,$3,$4,$5,$6,$7) as result',
   [action,org,study,proposalId,revision,choices===null?null:JSON.stringify(choices),reason]).then(rows=>rows[0].result);
 const getProject=()=>query('select title,revision,study from feasibility_projects where id=$1',[study]).then(rows=>rows[0]);
 await query("insert into profiles values ($1,'Source Owner','ar'),($2,'Recipient Member','en')",[owner,recipient]);
 await query("update feasibility_projects set revision=3,study=$1 where id=$2",
  [{title:'Water study',notes:'Original',unitPrice:100,monthlyUnits:50},study]);
 await actor(owner,()=>shareAccess('share',source,destination,3,3,'edit'));
 const edit=patch=>actor(recipient,async()=>{
  const shared=await shareAccess('open',destination);
  return shareAccess('edit',destination,null,shared.shared_revision,null,null,patch);
 });
 const edited=await edit({notes:'Recipient notes',unitPrice:110});
 assert.equal((await getProject()).study.notes,'Original');
 assert.deepEqual(await query('select type from notifications'),[]);
 await actor(recipient,()=>assert.rejects(proposal('submit',destination,null,edited.shared_revision-1),{code:'40001'}));
 const submitted=await actor(recipient,()=>proposal('submit',destination,null,edited.shared_revision));
 await actor(recipient,async()=>{
  await assert.rejects(proposal('submit',destination,null,edited.shared_revision),{code:'40001'});
  await assert.rejects(proposal('review',destination,submitted.id),{code:'42501'});
 });
 await actor(outsider,()=>assert.rejects(proposal('list',source),{code:'42501'}));
 assert.deepEqual(await query("select user_id,type,metadata->>'proposal' as proposal from notifications"),
  [{user_id:owner,type:'feasibility_share_proposal',proposal:submitted.id}]);
 await query("update feasibility_projects set revision=4,study=study||'{\"notes\":\"Owner notes\",\"monthlyUnits\":60}'::jsonb where id=$1",[study]);
 await actor(owner,async()=>{
  const review=await proposal('review',source,submitted.id);
  assert.equal(review.revision,4);
  assert.deepEqual(review.changes.find(change=>change.field==='notes'),{field:'notes',path:['notes'],
   before:'Original',after:'Recipient notes',current:'Owner notes',conflict:true,can_apply:true,resolution:null});
  await assert.rejects(proposal('approve',source,submitted.id,3,{notes:'current'}),{code:'40001'});
  await assert.rejects(proposal('approve',source,submitted.id,4,{}),{code:'40001'});
  await assert.rejects(proposal('approve',source,submitted.id,4,{unknown:'current'}),{code:'22023'});
  assert.equal((await proposal('approve',source,submitted.id,4,{notes:'current'})).state,'approved');
  await assert.rejects(proposal('approve',source,submitted.id,5,{notes:'proposed'}),{code:'40001'});
 });
 const approvedProject=await getProject();
 assert.equal(approvedProject.revision,5);
 assert.equal(approvedProject.study.notes,'Owner notes');
 assert.equal(approvedProject.study.unitPrice,110);
 assert.equal(approvedProject.study.monthlyUnits,60);
 const previous=(await query('select previous_study from private.feasibility_share_proposals where id=$1',[submitted.id]))[0].previous_study;
 assert.equal(previous.unitPrice,100);
 assert.equal(previous.notes,'Owner notes');
 assert.equal((await actor(owner,()=>proposal('review',source,submitted.id))).changes.find(change=>change.field==='notes').resolution,'current');
 assert.equal((await actor(recipient,()=>proposal('recipient',destination))).state,'approved');
 assert.equal((await actor(recipient,()=>proposal('recipient',destination))).can_submit,false);
 assert.deepEqual(await query("select user_id,type from notifications where type='feasibility_share_decision'"),
  [{user_id:recipient,type:'feasibility_share_decision'}]);

 await actor(owner,()=>shareAccess('share',source,destination,5,3,'edit'));
 const declinedEdit=await edit({title:'Declined title'});
 const toDecline=await actor(recipient,()=>proposal('submit',destination,null,declinedEdit.shared_revision));
 await actor(outsider,()=>mode('read'));
 await actor(owner,async()=>{
  await assert.rejects(proposal('approve',source,toDecline.id,5,{}),{code:'40001'});
  assert.equal((await proposal('reject',source,toDecline.id,null,null,'Use the current name')).state,'rejected');
 });
 assert.deepEqual(await getProject(),approvedProject);
 assert.equal((await actor(recipient,()=>proposal('recipient',destination))).reason,'Use the current name');
 await query("update subscription_private.plans set entitlement=entitlement||'{\"status\":\"expired\"}'::jsonb where organization_id=$1",[destination]);
 await actor(recipient,()=>assert.rejects(proposal('submit',destination,null,declinedEdit.shared_revision),{code:'42501'}));
 await actor(recipient,()=>assert.rejects(query('select * from private.feasibility_share_proposals'),{code:'42501'}));
 await actor(outsider,()=>mode('edit'));
 await actor(owner,()=>rpc('revoke',source,study,destination));
 console.log('PASS share proposals, owner notification, immutable submission, explicit conflicts, revision history, decline and decision notification');
 const beforeAudit=new Map((await query(catalog)).map(entry=>[entry.category+entry.object_key,entry.fingerprint]));
 await db.exec(await read('supabase/migrations/20261117134000_feasibility_organization_share_audit.sql'));
 const auditDelta={description:'Source owner access to the dated organization study sharing audit',
  upserts:(await query(catalog)).filter(entry=>beforeAudit.get(entry.category+entry.object_key)!==entry.fingerprint),removals:[]};
 const auditDeltaPath='tests/migration-history/feasibility-share-audit-schema-delta.json';
 if(process.argv.includes('--write-audit-delta')) await writeFile(new URL('../../'+auditDeltaPath,import.meta.url),JSON.stringify(auditDelta,null,2)+'\n');
 else assert.deepEqual(auditDelta,JSON.parse(await read(auditDeltaPath)));
 const activity=(org=source,project=study)=>query(
  'select public.feasibility_company_share_audit($1,$2) as result',[org,project]
 ).then(rows=>rows[0].result);
 await query(`insert into public.platform_audit_events(actor_user_id,event_type,entity_type,entity_id,details)
  values ($1,'feasibility.organization_share_share','feasibility_project',$2,
   jsonb_build_object('source_organization_id',$3::uuid,'recipient_organization_id',$4::uuid))`,
  [recipient,study,destination,legacyOrgA]);
 const records=await actor(owner,()=>activity());
 assert(records.some(x=>x.kind==='feasibility.organization_share_share'&&x.recipient_organization_id===destination));
 assert(records.some(x=>x.kind==='feasibility.organization_share_revoke'));
 assert(records.some(x=>x.kind==='feasibility.organization_share_edit'&&x.shared_revision>0));
 assert(records.some(x=>x.kind==='feasibility.share_proposal_submit'&&x.proposal_id===submitted.id));
 assert(records.some(x=>x.kind==='feasibility.share_proposal_approve'&&x.approved_revision===5));
 assert(records.some(x=>x.kind==='feasibility.share_proposal_reject'&&x.proposal_id===toDecline.id));
 assert(records.every(x=>x.recipient_organization_id===destination&&x.occurred_at&&!('details' in x)&&!('actor_user_id' in x)));
 await actor(recipient,()=>assert.rejects(activity(destination),{code:'42501'}));
 await actor(recipient,()=>assert.rejects(activity(source),{code:'42501'}));
 await actor(owner,()=>assert.rejects(activity(source,legacyStudyA),{code:'42501'}));
 await actor(outsider,()=>assert.rejects(activity(),{code:'42501'}));
 await query("insert into organization_members values ($1,$2,'MEMBER','ACTIVE')",[source,outsider]);
 await actor(outsider,()=>assert.rejects(activity(),{code:'42501'}));
 await query("update organization_members set status='SUSPENDED' where organization_id=$1 and user_id=$2",[source,owner]);
 await actor(owner,()=>assert.rejects(activity(),{code:'42501'}));
 await query("update organization_members set status='ACTIVE' where organization_id=$1 and user_id=$2",[source,owner]);
 await db.exec('set role anon');
 try{await assert.rejects(activity(),{code:'42501'});}finally{await db.exec('reset role');}
 console.log('PASS dated organization share audit and denied cross-tenant, non-owner and anonymous access');

 // Personal Phase 1 entitlement is represented by a synthetic writable/read-only grant fixture.
 await db.exec(`
  create table private.evidence_personal_grant (user_id uuid primary key, writable boolean not null);
  create function private.feasibility_phase1_has_access(p_write boolean) returns boolean
    language sql stable security definer set search_path='' as $$
    select exists(select 1 from private.evidence_personal_grant g where g.user_id=auth.uid() and (not p_write or g.writable))
   $$;
 `);
 await db.exec(await read('supabase/migrations/20261117190000_feasibility_evidence_documents.sql'));
 const personalStudy=id(20);
 await query("insert into feasibility_projects values ($1,null,$2,$2,1,'Personal evidence','{}')",[personalStudy,owner]);
 await query('insert into private.evidence_personal_grant values ($1,true)',[owner]);
 await query("insert into organization_members values ($1,$2,'VIEWER','ACTIVE')",[source,legacyOwnerA]);
 const evidence=(action,project,org,kind='licensing',doc=null,name=null,mime=null,bytes=null)=>
  query('select public.feasibility_evidence($1,$2,$3,$4,$5,$6,$7,$8) as result',
   [action,project,kind,org,doc,name,mime,bytes]).then(rows=>rows[0].result);
 const pdf=Buffer.from('%PDF-1.4 synthetic fixture').toString('base64');
 const upload=(project=study,org=source,kind='licensing',name='تصريح.pdf',bytes=pdf)=>
  evidence('upload',project,org,kind,null,name,'application/pdf',bytes);
 await actor(owner,()=>assert.rejects(evidence('list',study,source),{code:'42501'}));
 await query('update private.feasibility_evidence_feature_switch set enabled=true where singleton');
 const uploaded=await actor(owner,()=>upload());
 const valuation=await actor(owner,()=>upload(study,source,'valuation'));
 assert.notEqual(uploaded.id,valuation.id);
 assert.deepEqual(await actor(owner,()=>evidence('list',study,source)),[uploaded]);
 const downloaded=await actor(legacyOwnerA,()=>evidence('download',study,source,'licensing',uploaded.id));
 assert.equal(downloaded.name,'تصريح.pdf');
 assert.equal(Buffer.from(downloaded.base64,'base64').toString(),Buffer.from(pdf,'base64').toString());
 await actor(legacyOwnerA,()=>assert.rejects(upload(),{code:'42501'}));
 await actor(legacyOwnerA,()=>assert.rejects(evidence('remove',study,source,'licensing',uploaded.id),{code:'42501'}));
 await actor(recipient,()=>assert.rejects(evidence('download',study,source,'licensing',uploaded.id),{code:'42501'}));
 await actor(recipient,()=>assert.rejects(evidence('list',study,destination),{code:'42501'}));
 await actor(owner,async()=>{
  assert.equal(await evidence('download',study,source,'valuation',uploaded.id),null);
  await assert.rejects(evidence('list',study,null),{code:'42501'});
  await assert.rejects(upload(study,source,'licensing','wrong.pdf',Buffer.from('wrong bytes').toString('base64')),{code:'23514'});
  await assert.rejects(upload(study,source,'licensing','../unsafe.pdf'),{code:'23514'});
  await assert.rejects(upload(study,source,'licensing','oversized.pdf','A'.repeat(2796205)),{code:'22023'});
  await assert.rejects(query('select * from private.feasibility_evidence_documents'),{code:'42501'});
  assert.equal((await upload(personalStudy,null)).name,'تصريح.pdf');
 });
 await actor(recipient,()=>assert.rejects(evidence('list',personalStudy,null),{code:'42501'}));
 await query('update private.evidence_personal_grant set writable=false where user_id=$1',[owner]);
 await actor(owner,async()=>{
  assert.equal((await evidence('list',personalStudy,null)).length,1);
  await assert.rejects(upload(personalStudy,null),{code:'42501'});
  assert.equal((await evidence('remove',study,source,'licensing',uploaded.id)).id,uploaded.id);
  assert.deepEqual(await evidence('list',study,source),[]);
 });
 await db.exec('set role anon');
 try{await assert.rejects(evidence('list',study,source),{code:'42501'});}finally{await db.exec('reset role');}
 console.log('PASS private evidence files, scope isolation, read-only access, file limits, category separation and removal');

 await db.exec('update private.feasibility_org_feature_switch set enabled=false');
 await actor(recipient,()=>assert.rejects(rpc('open',destination),{code:'42501'}));
 await actor(owner,()=>assert.rejects(activity(),{code:'42501'}));
 assert.deepEqual(await actor(legacyOwnerA,()=>query('select id from feasibility_projects')),[]);
 await assert.rejects(db.exec(apply),/UNEXPECTED_QA_V2_FEASIBILITY_SCHEMA/);
 await db.exec('rollback');
 console.log('PASS QA V2 switch bridge, isolated paid fixture, preserved legacy reads, DELETE denial, immutable snapshot, 30-day cap, revocation and tenant isolation');
}finally{await db.close()}
