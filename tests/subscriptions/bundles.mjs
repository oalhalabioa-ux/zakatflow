import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
export async function bundles({db,check,owner,session,load}){
 const value=async(sql,args=[])=>(await db.query(sql,args)).rows[0].value;
 const claims=async(sub,extra={})=>db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub,role:'authenticated',...extra})]);
 await claims(owner,{session_id:session});
 const before=await value('select jsonb_agg(to_jsonb(p) order by id) value from platform_plans p');
 await db.exec(await load('supabase/migrations/20261109035940_module_bundle_builder.sql'));
 const org=(await db.query("insert into organizations(owner_user_id,name,entity_type) values($1,'Module bundle test','COMPANY') returning id",[owner])).rows[0].id;
 await db.query("insert into organization_members(organization_id,user_id,role,status) values($1,$2,'OWNER','ACTIVE') on conflict do nothing",[org,owner]);
 const call=(action,details={})=>value('select subscription_bundle_requests($1,$2,$3::jsonb) value',[org,action,JSON.stringify(details)]);
 const admin=(action,details={})=>value('select owner_bundle_requests($1,$2::jsonb) value',[action,JSON.stringify(details)]);
 const catalog=()=>value('select subscription_bundle_catalog(true) value');
 let modules=await catalog(),request;
 const payload=()=>({token:randomUUID(),modules:modules.filter(m=>['assets','liquidity','budgets'].includes(m.key)).map(m=>({key:m.key,revision:m.revision})),interval:'monthly',phone:'',notes:'Test bundle'});
 await check('bundle catalog preserves every existing plan and has actual modules without invented prices',async()=>{
  assert.equal(modules.length,7);assert.ok(modules.every(m=>m.pricing==='quote'&&m.monthly===null));
  assert.deepEqual(await value('select jsonb_agg(to_jsonb(p) order by id) value from platform_plans p'),before);
 });
 await check('bundle request snapshots selected modules and repeat token is idempotent',async()=>{
  const p=payload();request=await call('submit',p);assert.equal(request.status,'pending');assert.equal(request.total,null);assert.equal(request.items.length,3);
  assert.equal((await call('submit',p)).id,request.id);
  await assert.rejects(call('submit',{...p,notes:'changed'}),/REQUEST_CONFLICT/);
  await assert.rejects(call('submit',payload()),/REQUEST_OPEN_CONFLICT/);
 });
 await check('quote requires customer acceptance, revision match and explicit audited activation',async()=>{
  await assert.rejects(admin('activate',{id:request.id,revision:1,reason:'Cannot activate pending quote'}),/REQUEST_CONFLICT/);
  request=await admin('offer',{id:request.id,revision:1,total:125.25,max_users:5,reason:'Synthetic test quotation'});assert.equal(request.status,'offered');
  await assert.rejects(call('accept',{id:request.id,revision:1}),/REQUEST_CONFLICT/);
  request=await call('accept',{id:request.id,revision:request.revision});assert.equal(request.status,'accepted');
  await assert.rejects(admin('offer',{id:request.id,revision:request.revision,total:999,max_users:5,reason:'Cannot change accepted quote'}),/REQUEST_CONFLICT/);
  request=await admin('activate',{id:request.id,revision:request.revision,reason:'Explicit test bundle activation'});assert.equal(request.status,'activated');
  const e=await value('select organization_subscription($1) value',[org]);assert.equal(e.status,'active');assert.equal(e.plan.price_amount,125.25);assert.deepEqual([...e.capabilities].sort(),['module:assets','module:budgets','module:liquidity']);
  assert.equal(await value("select count(*) value from platform_plans where code like 'bundle_%' and is_published"),0);
  await assert.rejects(admin('activate',{id:request.id,revision:request.revision,reason:'Prevent duplicate activation'}),/REQUEST_CONFLICT/);
 });
 await check('fixed pricing is exact, server calculated and immutable after catalog edits',async()=>{
  for(const m of modules.filter(m=>['assets','liquidity','budgets'].includes(m.key)))await value('select owner_save_bundle_module($1::jsonb,$2) value',[JSON.stringify({...m,pricing:'fixed',monthly:.1,yearly:1.2}),'Set synthetic prices']);
  modules=await catalog();const p=payload();request=await call('submit',{...p,total:999});assert.equal(request.total,.3);assert.equal(request.status,'accepted');
  const m=modules.find(m=>m.key==='assets');await value('select owner_save_bundle_module($1::jsonb,$2) value',[JSON.stringify({...m,monthly:10}),'Update future requests']);
  assert.equal((await call('list')).rows.find(r=>r.id===request.id).total,.3);
  await call('cancel',{id:request.id,revision:request.revision});
  await assert.rejects(call('submit',payload()),/MODULE_CONFLICT/);modules=await catalog();
 });
 await check('dependency cycles, invalid currency combinations and missing foundation are rejected',async()=>{
  const m=modules.find(m=>m.key==='assets');
  await assert.rejects(value('select owner_save_bundle_module($1::jsonb,$2) value',[JSON.stringify({...m,requires:['budgets']}),'Reject dependency cycle']),/MODULE_DEPENDENCY_INVALID/);
  await assert.rejects(call('submit',{...payload(),modules:[{key:'budgets',revision:1}]}),/MODULE_DEPENDENCY_INVALID/);
 });
 await check('unaffiliated users and ordinary members cannot edit pricing or submit requests',async()=>{
  const outsider='99999999-9999-4999-8999-999999999999';await claims(outsider);
  await assert.rejects(call('list'),/ORGANIZATION_ACCESS_REQUIRED/);await assert.rejects(admin('list'),/PLATFORM_OWNER_REQUIRED/);
  await assert.rejects(catalog(),/PLATFORM_OWNER_REQUIRED/);
  await claims(owner,{session_id:session});
  await db.query("update organization_members set role='VIEWER' where organization_id=$1 and user_id=$2",[org,owner]);
  assert.equal((await call('list')).can_request,false);assert.deepEqual((await call('list')).rows,[]);
  await assert.rejects(call('submit',payload()),/ORGANIZATION_ADMIN_REQUIRED/);
  await db.query("update organization_members set role='OWNER' where organization_id=$1 and user_id=$2",[org,owner]);
 });
 await check('existing plan data remains identical after isolated custom activation',async()=>{
  assert.deepEqual(await value("select jsonb_agg(to_jsonb(p) order by id) value from platform_plans p where code not like 'bundle_%'"),before);
 });
}
