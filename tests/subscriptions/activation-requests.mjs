// Imported by the full observed-schema suite; all identities/data are synthetic.
import assert from 'node:assert/strict';
export async function activationRequests({db,check,owner,session,legacy}){
 const value=async(sql,args=[])=>(await db.query(sql,args)).rows[0].value;
 const claims=async(sub,extra={})=>db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub,role:'authenticated',...extra})]);
 const plan=(await db.query("select id from platform_plans where code='advanced_monthly'")).rows[0].id;
 let request;
 await check('legacy request snapshots server price, is idempotent, and never changes existing access',async()=>{
  request=await value("select subscription_activation_requests($1,'submit',$2,'+966500000000','Please activate our selected plan') value",[legacy.id,plan]);
  assert.equal(request.quote.price_amount,399);assert.equal(request.quote.max_users,15);assert.equal(request.status,'pending');
  const duplicate=await value("select subscription_activation_requests($1,'submit',$2) value",[legacy.id,plan]);assert.equal(duplicate.id,request.id);
  assert.equal((await value('select organization_subscription($1) value',[legacy.id])).status,'legacy');
  const other=(await db.query("select id from platform_plans where code='professional_monthly'")).rows[0].id;
  await assert.rejects(db.query("select subscription_activation_requests($1,'submit',$2)",[legacy.id,other]),/REQUEST_OPEN_CONFLICT/);
 });
 const outsider='22222222-2222-4222-8222-222222222222';
 await check('ordinary and unaffiliated callers cannot list other requests or approve/pay/modify settings',async()=>{
  await claims(outsider);
  await assert.rejects(db.query('select subscription_activation_requests($1)',[legacy.id]),/ORGANIZATION_ACCESS_REQUIRED/);
  for(const sql of ['select owner_activation_requests()','select owner_subscription_panel()',"select owner_payment_readiness('example','test',1,'Unauthorized change')",`select owner_review_activation_request('${request.id}',1,'approve','Unauthorized activation',now()+interval '1 month')`])await assert.rejects(db.query(sql),/PLATFORM_OWNER_REQUIRED/);
  await claims(owner,{session_id:session});
 });
 await check('only authenticated execution is granted and private requests have RLS without client grants',async()=>{
  assert.equal((await db.query("select has_function_privilege('anon','public.owner_activation_requests(text,text,integer)','execute') allowed")).rows[0].allowed,false);
  assert.equal((await db.query("select has_table_privilege('authenticated','subscription_private.activation_requests','select') allowed")).rows[0].allowed,false);
  await assert.rejects(db.query('update subscription_private.payment_readiness set enabled=true'),/check constraint/);
 });
 await check('review and request information audit decisions, stale/cancelled decisions reject',async()=>{
  const reviewed=await value("select owner_review_activation_request($1,1,'needs_info','Please provide contact details') value",[request.id]);assert.equal(reviewed.status,'needs_info');assert.equal(reviewed.revision,2);
  await assert.rejects(db.query("select owner_review_activation_request($1,1,'reject','Stale decision')",[request.id]),/REQUEST_CONFLICT/);
  const resubmitted=await value("select subscription_activation_requests($1,'resubmit',null,'+966500000001','Requested extra information',$2,2) value",[legacy.id,request.id]);assert.equal(resubmitted.status,'pending');assert.equal(resubmitted.quote.price_amount,399);assert.equal(resubmitted.revision,3);
  const cancelled=await value("select subscription_activation_requests($1,'cancel',null,'','',$2,3) value",[legacy.id,request.id]);assert.equal(cancelled.status,'cancelled');
  await assert.rejects(db.query("select owner_review_activation_request($1,3,'approve','Cannot approve cancelled',now()+interval '1 month')",[request.id]),/REQUEST_CONFLICT/);
 });
 await check('approval atomically uses existing subscription guards and activates exact immutable quote',async()=>{
  request=await value("select subscription_activation_requests($1,'submit',$2) value",[legacy.id,plan]);
  await assert.rejects(db.query("select owner_review_activation_request($1,1,'approve','Missing subscription deadline')",[request.id]),/PAID_SUBSCRIPTION_DETAILS_REQUIRED/);
  assert.equal((await value('select organization_subscription($1) value',[legacy.id])).status,'legacy');
  const approved=await value("select owner_review_activation_request($1,1,'approve','Approved manual activation',now()+interval '1 month') value",[request.id]);assert.equal(approved.status,'approved');
  const e=await value('select organization_subscription($1) value',[legacy.id]);assert.equal(e.status,'active');assert.equal(e.plan.price_amount,399);assert.equal(e.max_users,15);
  await assert.rejects(db.query("select owner_review_activation_request($1,2,'approve','Duplicate approval',now()+interval '1 year')",[request.id]),/REQUEST_CONFLICT/);
  assert.equal((await db.query("select count(*) n from platform_audit_events where event_type='activation_request.approve' and entity_id=$1",[request.id])).rows[0].n,1);
 });
 await check('requests remain available after expiry and quote edits cannot silently alter submitted agreement',async()=>{
  await db.query("update platform_subscriptions set started_at=now()-interval '2 days',current_period_end=now()-interval '1 second' where organization_id=$1",[legacy.id]);
  request=await value("select subscription_activation_requests($1,'submit',$2) value",[legacy.id,plan]);
  await db.query('update platform_plans set price_amount=price_amount+1 where id=$1',[plan]);
  await assert.rejects(db.query("select owner_review_activation_request($1,1,'approve','Cannot activate changed quote',now()+interval '1 month')",[request.id]),/PLAN_QUOTE_CONFLICT/);
  assert.equal((await value('select organization_subscription($1) value',[legacy.id])).status,'expired');
  await db.query('update platform_plans set price_amount=price_amount-1 where id=$1',[plan]);
  await db.query("select subscription_activation_requests($1,'cancel',null,'','',$2,1)",[legacy.id,request.id]);
 });
 await check('payment readiness changes are audited while payment capability stays disabled',async()=>{
  const r=await value("select owner_payment_readiness('Planned provider','test',1,'Prepare future provider configuration') value");assert.equal(r.enabled,false);assert.equal(r.revision,2);
  await assert.rejects(db.query("select owner_payment_readiness('Other','test',1,'Stale provider setting')"),/PAYMENT_CONFLICT/);
  const panel=await value('select owner_subscription_panel($1) value',[legacy.id]);assert.equal(panel.members.length,1);
 });
}
