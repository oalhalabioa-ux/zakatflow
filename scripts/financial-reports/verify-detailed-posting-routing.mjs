// Exercises the real migration, trigger, resolved snapshot and closing trial
// in a disposable PostgreSQL/WASM database, with fixture source adapters.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
const {PGlite}=await import(process.env.FISCAL_POSTGRES_TEST_MODULE);
const db=new PGlite();
const org='10000000-0000-4000-8000-000000000001';
const other='10000000-0000-4000-8000-000000000002';
const id=n=>'20000000-0000-4000-8000-'+String(n).padStart(12,'0');
const first=id(1),second=id(2),history=id(3),receipt=id(4),missing=id(5),future=id(6),bank=id(7),bankTwo=id(8),reversal=id(9);
const sql=async(text,params=[])=>db.query(text,params);
const query=async(text,params=[]) => (await sql(text,params)).rows;
const rule=(credit='110001',detailed=true)=>({eventType:'SETTLEMENT',sourceModule:'OPERATIONAL_CONSOLE',classificationId:'receivable:BASE',cashDirection:'INFLOW',debitAccountId:'1000',creditAccountId:credit,cashActivity:'OPERATING',...(detailed?{detailed:true}:{})});
const event=(eventId)=>({id:eventId,organizationId:org,eventType:'SETTLEMENT',sourceModule:'OPERATIONAL_CONSOLE',currency:'SAR',date:'2026-08-01',status:'ACTUAL',
 lines:[{id:eventId+':BASE',classificationId:'receivable:BASE',cashDirection:'INFLOW',recognitionSign:1,baseAmount:'100.0000'}]});
const accounts=[
 {id:'1000',kind:'ASSET',cash:true},{id:'1100',kind:'ASSET',cash:false},{id:'3100',kind:'EQUITY',cash:false},{id:'3300',kind:'EQUITY',cash:false},
].map(a=>({...a,code:a.id,organizationId:org,currency:'SAR',ar:a.id,en:a.id,presentation:a.kind==='ASSET'?'CURRENT':'OTHER'}));
async function post(eventId,accountId,raw=event(eventId),direction='INFLOW'){
 await db.transaction(async tx=>{
  await tx.query('insert into source_events values($1,$2)',[eventId,JSON.stringify(raw)]);
  if(accountId)await tx.query("insert into liquidity_settlements values($1,$2,$3,'POSTED',$4,100)",[org,eventId,accountId,direction]);
  await tx.query("insert into financial_events values($1,$2,$3,'ACTUAL')",[eventId,org,raw.date]);
 });
}
try{
 await db.exec(`create role anon;create role authenticated;create schema private;
  create table organizations(id uuid primary key);
  create table financial_opening_workspaces(id uuid primary key);
  create table financial_reporting_policies(id uuid primary key,organization_id uuid,fiscal_start date,fiscal_end date,status text,rules jsonb,approved_at timestamptz);
  create table financial_events(id uuid primary key,organization_id uuid,event_date date,status text);
  create table financial_event_links(organization_id uuid,event_id uuid,related_event_id uuid,link_type text);
  create table liquidity_flows(id uuid,organization_id uuid,account_id uuid,status text,direction text);
  create table liquidity_settlements(organization_id uuid,financial_event_id uuid,account_id uuid,status text,direction text,base_amount numeric);
  create table liquidity_accounts(id uuid,organization_id uuid,currency text,entity_id uuid,active boolean);
  create table financial_cash_account_links(organization_id uuid,account_id uuid,chart_account_id uuid,currency text,entity_id uuid);
  create table financial_chart_custom_accounts(id uuid,organization_id uuid,code text,reporting_code text,parent_code text,is_active boolean,is_postable boolean,name_ar text,name_en text);
  create table source_events(id uuid,ev jsonb);
  create function private.financial_reporting_events(uuid,date,date) returns jsonb language sql stable as $$select coalesce(jsonb_agg(ev),'[]') from public.source_events where ev->>'organizationId'=$1::text and (ev->>'date')::date between $2 and $3$$;
  create function private.financial_policy_postable_events(uuid,date,date) returns jsonb language sql stable as $$select private.financial_reporting_events($1,$2,$3)$$;
  create function public.financial_reporting_chart() returns jsonb language sql immutable as $$select '${JSON.stringify(accounts)}'::jsonb$$;
  set check_function_bodies=off;
 `);
 // Exact deployed definitions may be supplied when generating catalog hashes.
 // By default the untouched compiler comes from the canonical fiscal migration.
 if(process.env.POSTING_BASELINE_SQL)await db.exec(await readFile(process.env.POSTING_BASELINE_SQL,'utf8'));
 else {
  const engine=await readFile('supabase/migrations/20261104093720_general_fiscal_opening_engine.sql','utf8');
  const trial=engine.slice(engine.indexOf('create function private.financial_fiscal_trial('),engine.indexOf('create function private.financial_fiscal_next_source(')).replaceAll('private.financial_fiscal_trial(', 'private.financial_fiscal_trial_detail_v1(');
  await db.exec(trial);
  await db.exec(`create function private.financial_statement_live_snapshot_v1(p_org uuid,p_from date,p_to date) returns jsonb language plpgsql as $$begin
   return jsonb_build_object('origin','LIVE_CANONICAL_EVENTS','coverage',jsonb_build_object('readAt',statement_timestamp()));end$$;
   create function public.financial_reporting_policy_workspace(p_org uuid,p_fiscal_start date) returns jsonb language plpgsql as $$declare result jsonb:='[]';begin return jsonb_build_object('events',result,'canSave',true);end$$;`);
 }
 if(process.env.POSTING_SAVE_BASELINE_SQL)await db.exec(await readFile(process.env.POSTING_SAVE_BASELINE_SQL,'utf8'));
 else {
  const source=await readFile('supabase/migrations/20261103145436_financial_reporting_cash_controls.sql','utf8');
  await db.exec(source.slice(0,source.indexOf('create or replace function public.financial_statement_live_snapshot')));
 }
 await db.exec(await readFile('supabase/migrations/20261109101216_detailed_posting_routing.sql','utf8'));
 await sql('insert into organizations values($1),($2)',[org,other]);
 await sql("insert into liquidity_accounts values($1,$3,'SAR',null,true),($2,$3,'SAR',null,true)",[bank,bankTwo,org]);
 for(const [index,code,root] of [[11,'100001','1000'],[12,'100002','1000'],[13,'110001','1100'],[14,'110002','1100']])
  await sql('insert into financial_chart_custom_accounts values($1,$2,$3,$4,$4,true,true,$3,$3)',[id(index),org,code,root]);
 await sql("insert into financial_cash_account_links values($1,$2,$4,'SAR',null),($1,$3,$5,'SAR',null)",[org,bank,bankTwo,id(11),id(12)]);
 await sql("insert into financial_reporting_policies values($1,$2,'2026-01-01','2026-12-31','APPROVED',$3,'2026-01-01')",[first,org,JSON.stringify([rule('1100',false)])]);
 await post(history,bank);
 const saved=async(eventId)=> (await query('select lines from private.financial_event_posting_resolutions where event_id=$1',[eventId]))[0]?.lines;
 assert.equal(await saved(history),undefined);
 async function approve(policyId,prior,rules){
  await db.transaction(async tx=>{
   await tx.query("insert into financial_reporting_policies values($1,$2,'2026-01-01','2026-12-31','DRAFT',$3,null)",[policyId,org,JSON.stringify(rules)]);
   await tx.query("update financial_reporting_policies set status='SUPERSEDED' where id=$1",[prior]);
   await tx.query("update financial_reporting_policies set status='APPROVED',approved_at=now() where id=$1",[policyId]);
  });
 }
 await assert.rejects(approve(second,first,[rule('1100')]),/REPORTING_DETAIL_ACCOUNT_REQUIRED/);
 await approve(second,first,[rule()]);
 assert.equal((await saved(history))[0].debitAccountId,'1000');
 assert.equal((await saved(history))[0].creditAccountId,'1100');
 await post(receipt,bankTwo);
 assert.equal((await saved(receipt))[0].debitAccountId,'100002');
 assert.equal((await saved(receipt))[0].creditAccountId,'110001');
 await assert.rejects(post(missing,null),/REPORTING_VOUCHER_CASH_LINK_REQUIRED/);
 assert.equal((await query('select id from financial_events where id=$1',[missing])).length,0);
 await assert.rejects(post(missing,bank,{...event(missing),lines:event(missing).lines.map(l=>({...l,baseAmount:'99'}))}),/REPORTING_VOUCHER_CASH_AMOUNT_INVALID/);
 await assert.rejects(post(missing,bank,{...event(missing),eventType:'EXPENSE'}),/REPORTING_POLICY_SOURCE_UNMAPPED/);
 await approve(id(20),second,[rule('110002')]);
 await post(future,bank);
 assert.equal((await saved(future))[0].debitAccountId,'100001');
 assert.equal((await saved(future))[0].creditAccountId,'110002');
 assert.equal((await saved(receipt))[0].creditAccountId,'110001');
 const original={...event(receipt),status:'REVERSED'};
 await sql('update source_events set ev=$1 where id=$2',[JSON.stringify(original),receipt]);
 const reverse={...event(reversal),reversesEventId:receipt,lines:event(reversal).lines.map(l=>({...l,recognitionSign:-1}))};
 await post(reversal,bankTwo,reverse,'OUTFLOW');
 assert.equal((await saved(reversal))[0].debitAccountId,'100002');
 const snapshot={organizationId:org,currency:'SAR',fiscalStart:'2026-01-01',from:'2026-01-01',to:'2026-12-31',accounts,opening:[],
  events:[event(history),original,event(future),reverse],policy:{id:id(20),approvedBy:'fixture-owner',rules:[rule('110002')]},coverage:{}};
 const [{snapshot:resolved}]=await query('select private.financial_apply_resolved_postings($1,$2) snapshot',[org,JSON.stringify(snapshot)]);
 assert.equal(resolved.events[1].lines[0].resolvedPosting.debitAccountId,'100002');
 const [{trial}]=await query("select private.financial_fiscal_trial_detail_v1($1,'3300') trial",[JSON.stringify(resolved)]);
 assert.equal(Number(trial.trialBalance.find(r=>r.accountId==='1000').closing),100);
 assert.equal(Number(trial.trialBalance.find(r=>r.accountId==='100001').closing),100);
 assert.equal(Number(trial.trialBalance.find(r=>r.accountId==='100002').closing),0);
 const refundRule={...rule('110002'),cashDirection:'OUTFLOW',debitAccountId:'110002',creditAccountId:'1000'};
 await approve(id(21),id(20),[rule('110002'),refundRule]);
 const paymentId=id(22),payment=event(paymentId);
 payment.lines[0]={...payment.lines[0],cashDirection:'OUTFLOW'};
 await post(paymentId,bankTwo,payment,'OUTFLOW');
 const [paymentLeg]=await saved(paymentId);
 assert.equal(paymentLeg.debitAccountId,'110002');
 assert.equal(paymentLeg.creditAccountId,'100002','Payment credits the bank recorded on the voucher');
 assert.equal((await query("select has_table_privilege('authenticated','private.financial_event_posting_resolutions','select') granted"))[0].granted,false);
 // Exercise the same draft-save RPC the browser uses, not just approval triggers.
 await db.exec(`create schema auth;
  create function auth.uid() returns uuid language sql stable as $$select '${id(30)}'::uuid$$;
  alter table public.organizations add column base_currency text default 'SAR';
  alter table public.financial_reporting_policies alter column id set default gen_random_uuid(),
   alter column status set default 'DRAFT',add column currency text,add column reason text,
   add column version integer default 1,add column created_by uuid,add column updated_by uuid,add column updated_at timestamptz;
  create table public.financial_reporting_policy_audit(organization_id uuid,policy_id uuid,actor_id uuid,action text,version integer,detail jsonb);
  create function private.financial_assert_open_period(uuid,date) returns void language plpgsql as $$begin end$$;
  create function private.financial_opening_can(uuid,text) returns boolean language sql as $$select true$$;
  create function private.financial_period_end(uuid,date) returns date language sql as $$select ($2+interval '1 year - 1 day')::date$$;
  create function public.financial_chart_posting_accounts(uuid) returns jsonb language sql as $$select public.financial_reporting_chart()$$;`);
 const save=rules=>query("select public.save_financial_reporting_policy($1,'2028-01-01',0,$2,'Detailed draft save') policy",[org,JSON.stringify(rules)]);
 await assert.rejects(save([{...rule('1100'),detailed:false}]),/REPORTING_POLICY_INVALID/);
 await assert.rejects(save([{...rule('1100'),unexpected:true}]),/REPORTING_POLICY_INVALID/);
 const savedDraft=(await save([rule('1100')]))[0].policy;
 assert.equal(savedDraft.status,'DRAFT');assert.equal(savedDraft.rules[0].detailed,true);
 if(process.argv.includes('--write-delta')){
  assert.ok(process.env.POSTING_BASELINE_SQL,'Exact baseline required for patched function fingerprints');
  const catalog=(await readFile('tests/migration-history/catalog.sql','utf8')).trim().replace(/;$/,'');
  const keys=/financial_event_posting_resolutions|financial_detailed_|financial_assert_detailed_rules|financial_voucher_cash_leaf|financial_resolve_event_posting|financial_capture_policy_history|financial_capture_actual_posting|financial_apply_resolved_postings|financial_statement_live_snapshot_v1|financial_reporting_policy_workspace|save_financial_reporting_policy|financial_fiscal_trial_detail_v1/;
  const rows=(await query(catalog)).filter(row=>keys.test(row.object_key));
  await writeFile('tests/migration-history/detailed-posting-schema-delta.json',JSON.stringify({description:'Detailed posting resolution, protected history and common statement/closing legs.',removals:[],upserts:rows},null,2)+'\n');
 }
 // Apply the payment follow-up after historical fixtures already have
 // captured legs. The deferred trigger must not rewrite them.
 await db.exec(`alter table public.financial_events add column event_type text,add column source_module text,
  add column source_event_key text,add column source_record_id uuid;
  create table financial_classifications(id uuid,organization_id uuid,classification_type text);
  create table financial_event_lines(organization_id uuid,event_id uuid,classification_id uuid);
  create table financial_event_obligations(id uuid,organization_id uuid,event_id uuid,obligation_type text);
  create table financial_event_obligation_allocations(organization_id uuid,application_event_id uuid,
   obligation_id uuid,allocation_type text,base_amount numeric);`);
 await db.exec(await readFile('supabase/migrations/20261109130118_preserve_manual_payment_posting.sql','utf8'));
 for(const [index,code,root] of [[31,'210001','2100'],[32,'210002','2100'],[33,'150001','1500'],[34,'610001','6100']])
  await sql('insert into financial_chart_custom_accounts values($1,$2,$3,$4,$4,true,true,$3,$3)',[id(index),org,code,root]);
 await sql("insert into financial_classifications values($1,$2,'OPEX'),($3,$2,'CAPEX')",[id(45),org,id(46)]);
 await sql("insert into financial_classifications values($1,$2,'INVESTMENT')",[id(47),org]);
 await sql('insert into financial_chart_custom_accounts values($1,$2,$3,$4,$4,true,true,$3,$3)',[id(48),org,'160001','1600']);
 const genericPayable={...refundRule,classificationId:'payable:BASE',debitAccountId:'210001'};
 const originalRule=(eventType,classificationId,debitAccountId)=>({
  eventType,sourceModule:'OPERATIONAL_CONSOLE',classificationId,cashDirection:'NON_CASH',
  debitAccountId,creditAccountId:'210002',detailed:true,
 });
 await approve(id(35),id(21),[rule('110002'),refundRule,genericPayable,
  originalRule('ASSET_PURCHASE','investment:BASE','160001'),originalRule('ASSET_PURCHASE','asset:BASE','150001'),originalRule('EXPENSE','rent:BASE','610001')]);
 async function recordManualExpense(eventId,flowId,obligationId,eventType,classificationId){
  const raw={...event(eventId),eventType,lines:[{...event(eventId).lines[0],classificationId,
   cashDirection:'NON_CASH',baseAmount:'300.0000'}]};
  await db.transaction(async tx=>{
   await tx.query('insert into source_events values($1,$2)',[eventId,JSON.stringify(raw)]);
   await tx.query(`insert into financial_events(id,organization_id,event_date,status,event_type,source_module,source_event_key,source_record_id)
    values($1,$2,'2026-08-01','ACTUAL',$3,'OPERATIONAL_CONSOLE',$4,$5)`,
    [eventId,org,eventType,'liquidity:'+flowId+':recognition',flowId]);
   await tx.query('insert into financial_event_lines values($1,$2,$3)',[org,eventId,({'rent:BASE':id(45),'asset:BASE':id(46),'investment:BASE':id(47)})[classificationId]]);
   await tx.query("insert into financial_event_obligations values($1,$2,$3,'PAYABLE')",[obligationId,org,eventId]);
  });
 }
 async function postManualPayment(eventId,accountId,allocations){
  const raw={...event(eventId),date:'2026-08-02',lines:[{...event(eventId).lines[0],classificationId:'payable:BASE',cashDirection:'OUTFLOW'}]};
  await db.transaction(async tx=>{
   await tx.query('insert into source_events values($1,$2)',[eventId,JSON.stringify(raw)]);
   await tx.query("insert into liquidity_settlements values($1,$2,$3,'POSTED','OUTFLOW',100)",[org,eventId,accountId]);
   for(const [obligation,amount] of allocations)
    await tx.query("insert into financial_event_obligation_allocations values($1,$2,$3,'PAYMENT',$4)",[org,eventId,obligation,amount]);
   await tx.query("insert into financial_events(id,organization_id,event_date,status) values($1,$2,'2026-08-02','ACTUAL')",[eventId,org]);
  });
 }
 await recordManualExpense(id(36),id(37),id(38),'ASSET_PURCHASE','asset:BASE');
 await recordManualExpense(id(39),id(40),id(41),'EXPENSE','rent:BASE');
 await recordManualExpense(id(49),id(50),id(51),'ASSET_PURCHASE','investment:BASE');
 await postManualPayment(id(52),bankTwo,[[id(51),100]]);
 await postManualPayment(id(42),bank,[[id(38),100]]);
 await postManualPayment(id(43),bankTwo,[[id(41),100]]);
 for(const [payment,bankCode,activity] of [[id(42),'100001','INVESTING'],[id(43),'100002','OPERATING'],[id(52),'100002','INVESTING']]){
  const [leg]=await saved(payment);
  assert.equal(leg.debitAccountId,'210002');
  assert.equal(leg.creditAccountId,bankCode);
  assert.equal(leg.cashActivity,activity);
 }
 // Reversing a payment must use its captured liability and bank even when
 // the generic payable rule points elsewhere.
 const reversedPayment={...event(id(53)),reversesEventId:id(52),
  lines:[{...event(id(53)).lines[0],classificationId:'payable:BASE',
   cashDirection:'OUTFLOW',recognitionSign:-1}]};
 await post(id(53),bankTwo,reversedPayment,'INFLOW');
 const [reversedLeg]=await saved(id(53));
 assert.equal(reversedLeg.debitAccountId,'210002');
 assert.equal(reversedLeg.creditAccountId,'100002');
 assert.equal(reversedLeg.cashActivity,'INVESTING');
 await assert.rejects(postManualPayment(id(44),bank,[[id(38),60],[id(41),40]]),/REPORTING_PAYMENT_ALLOCATION_REQUIRED/);
 await assert.rejects(postManualPayment(id(44),bank,[[id(38),99]]),/REPORTING_PAYMENT_ALLOCATION_REQUIRED/);
 assert.equal((await query('select id from financial_events where id=$1',[id(44)])).length,0);
 assert.deepEqual((await saved(paymentId))[0],paymentLeg,'Historical settlement legs must be unchanged');
 const catalog=(await readFile('tests/migration-history/catalog.sql','utf8')).trim().replace(/;$/,'');
 const delta={description:'Capture original payable and cash activity for new manual liquidity payments.',removals:[],
  upserts:(await query(catalog)).filter(row=>/^private\.financial_(resolve_manual_payment|capture_actual_posting)\(/.test(row.object_key))};
 assert.equal(delta.upserts.length,2);
 const paymentDelta='tests/migration-history/manual-payment-posting-schema-delta.json';
 if(process.argv.includes('--write-payment-delta'))await writeFile(paymentDelta,JSON.stringify(delta,null,2)+'\n');
 else assert.deepEqual(JSON.parse(await readFile(paymentDelta,'utf8')),delta);

 const inheritanceSql=await readFile('supabase/migrations/20261109151753_automatic_account_rule_inheritance.sql','utf8');
 await db.exec(inheritanceSql.split('-- BEGIN INHERITED SETTLEMENT RESOLVER')[1].split('-- END INHERITED SETTLEMENT RESOLVER')[0]);
 for(const [index,code,root] of [[55,'410001','4100'],[58,'230001','2300'],[59,'810001','8100']])
  await sql('insert into financial_chart_custom_accounts values($1,$2,$3,$4,$4,true,true,$3,$3)',[id(index),org,code,root]);
 await sql("insert into financial_classifications values($1,$3,'REVENUE'),($2,$3,'TAX')",[id(56),id(57),org]);
 const revenueRule={...originalRule('REVENUE','income:BASE','110001'),creditAccountId:'410001'};
 const taxRule={...originalRule('EXPENSE','tax:BASE','810001'),creditAccountId:'230001'};
 await approve(id(60),id(35),[rule('110002'),refundRule,genericPayable,revenueRule,taxRule,
  originalRule('ASSET_PURCHASE','investment:BASE','160001'),originalRule('ASSET_PURCHASE','asset:BASE','150001'),originalRule('EXPENSE','rent:BASE','610001')]);
 async function recognizeDetail(eventId,flowId,obligationId,type,classificationId,classId,side){
  const raw={...event(eventId),eventType:type,lines:[{...event(eventId).lines[0],classificationId,cashDirection:'NON_CASH',baseAmount:'300.0000'}]};
  await db.transaction(async tx=>{
   await tx.query('insert into source_events values($1,$2)',[eventId,JSON.stringify(raw)]);
   await tx.query("insert into financial_events(id,organization_id,event_date,status,event_type,source_module,source_event_key,source_record_id) values($1,$2,'2026-08-01','ACTUAL',$3,'OPERATIONAL_CONSOLE',$4,$5)",[eventId,org,type,'liquidity:'+flowId+':recognition',flowId]);
   await tx.query('insert into financial_event_lines values($1,$2,$3)',[org,eventId,classId]);
   await tx.query('insert into financial_event_obligations values($1,$2,$3,$4)',[obligationId,org,eventId,side]);
  });
 }
 await recognizeDetail(id(61),id(62),id(63),'REVENUE','income:BASE',id(56),'RECEIVABLE');
 await recognizeDetail(id(64),id(65),id(66),'EXPENSE','tax:BASE',id(57),'PAYABLE');
 await postManualPayment(id(67),bank,[[id(66),100]]);
 const [taxPayment]=await saved(id(67));
 assert.equal(taxPayment.debitAccountId,'230001');assert.equal(taxPayment.creditAccountId,'100001');
 await db.transaction(async tx=>{
  await tx.query('insert into source_events values($1,$2)',[id(68),JSON.stringify({...event(id(68)),date:'2026-08-02'})]);
  await tx.query("insert into liquidity_settlements values($1,$2,$3,'POSTED','INFLOW',100)",[org,id(68),bankTwo]);
  await tx.query("insert into financial_event_obligation_allocations values($1,$2,$3,'PAYMENT',100)",[org,id(68),id(63)]);
  await tx.query("insert into financial_events(id,organization_id,event_date,status) values($1,$2,'2026-08-02','ACTUAL')",[id(68),org]);
 });
 const [collection]=await saved(id(68));
 assert.equal(collection.creditAccountId,'110001');assert.equal(collection.debitAccountId,'100002');
 assert.equal(collection.cashActivity,'OPERATING');
 const reversedCollection={...event(id(69)),date:'2026-08-03',reversesEventId:id(68),lines:[{...event(id(69)).lines[0],recognitionSign:-1}]};
 await post(id(69),bankTwo,reversedCollection,'OUTFLOW');
 const [collectionReversal]=await saved(id(69));
 assert.equal(collectionReversal.creditAccountId,'110001');assert.equal(collectionReversal.debitAccountId,'100002');
 assert.deepEqual((await saved(id(42)))[0].debitAccountId,'210002');
 // Native multi-line asset obligations preserve their original net counterparty leg.
 await db.exec('alter table financial_event_obligations add column settleable_base_amount numeric');
 await db.exec(await readFile('supabase/migrations/20261109171915_preserve_native_asset_settlement.sql','utf8'));
 for(const [index,code,root] of [[100,'159001','1590'],[101,'140001','1400']])
  await sql('insert into financial_chart_custom_accounts values($1,$2,$3,$4,$4,true,true,$3,$3)',[id(index),org,code,root]);
 const nativeRule=(module,type,role,debit,credit)=>({eventType:type,sourceModule:module,classificationId:id(46)+':'+role,cashDirection:'NON_CASH',debitAccountId:debit,creditAccountId:credit,detailed:true});
 const lifecycleRules=[['SALE_LOSS','610001','110001'],['SALE_NET_BOOK_VALUE','110001','150001'],['OUTPUT_VAT','110001','230001'],['ACCUMULATED_DEPRECIATION_RELEASE','159001','150001']].map(([r,d,c])=>nativeRule('ASSET_LIFECYCLE','ADJUSTMENT',r,d,c));
 const purchaseRules=[nativeRule('ASSETS_INTEGRATION','ASSET_PURCHASE','BASE','150001','210002'),nativeRule('ASSETS_INTEGRATION','ASSET_PURCHASE','VAT','140001','210002')];
 await approve(id(102),id(60),[rule('110002'),refundRule,genericPayable,...lifecycleRules,...purchaseRules]);
 async function nativeOrigin(n,purchase=false,total=purchase?1150:460){
  const eventId=id(n),obligationId=id(n+1),module=purchase?'ASSETS_INTEGRATION':'ASSET_LIFECYCLE',type=purchase?'ASSET_PURCHASE':'ADJUSTMENT';
  const parts=purchase?[['BASE',1000],['VAT',150]]:[['SALE_LOSS',50],['SALE_NET_BOOK_VALUE',450],['OUTPUT_VAT',60],['ACCUMULATED_DEPRECIATION_RELEASE',50]];
  const raw={...event(eventId),eventType:type,sourceModule:module,lines:parts.map(([role,amount],i)=>({id:id(n+10+i)+':'+role,classificationId:id(46)+':'+role,cashDirection:'NON_CASH',recognitionSign:1,baseAmount:String(amount)}))};
  await db.transaction(async tx=>{
   await tx.query('insert into source_events values($1,$2)',[eventId,JSON.stringify(raw)]);
   await tx.query("insert into financial_events(id,organization_id,event_date,status,event_type,source_module,source_record_id,source_event_key) values($1,$2,'2026-08-01','ACTUAL',$3,$4,$1,$5)",[eventId,org,type,module,(purchase?'asset-purchase:':'asset-lifecycle:')+eventId]);
   await tx.query('insert into financial_event_lines values($1,$2,$3)',[org,eventId,id(46)]);
   await tx.query('insert into financial_event_obligations values($1,$2,$3,$4,$5)',[obligationId,org,eventId,purchase?'PAYABLE':'RECEIVABLE',total]);
  });return obligationId;
 }
 async function nativePayment(n,obligation,purchase=false,allocation=100){
  const eventId=id(n),direction=purchase?'OUTFLOW':'INFLOW';
  const raw={...event(eventId),date:'2026-08-02',lines:[{...event(eventId).lines[0],classificationId:purchase?'payable:BASE':'receivable:BASE',cashDirection:direction}]};
  await db.transaction(async tx=>{
   await tx.query('insert into source_events values($1,$2)',[eventId,JSON.stringify(raw)]);
   await tx.query("insert into liquidity_settlements values($1,$2,$3,'POSTED',$4,100)",[org,eventId,bankTwo,direction]);
   await tx.query("insert into financial_event_obligation_allocations values($1,$2,$3,'PAYMENT',$4)",[org,eventId,obligation,allocation]);
   await tx.query("insert into financial_events(id,organization_id,event_date,status) values($1,$2,'2026-08-02','ACTUAL')",[eventId,org]);
  });
 }
 const saleObligation=await nativeOrigin(110);
 await nativePayment(125,saleObligation);
 const [assetCollection]=await saved(id(125));
 assert.equal(assetCollection.creditAccountId,'110001');assert.equal(assetCollection.debitAccountId,'100002');assert.equal(assetCollection.cashActivity,'INVESTING');
 const acquisitionObligation=await nativeOrigin(130,true);
 await nativePayment(145,acquisitionObligation,true);
 const [assetPayment]=await saved(id(145));
 assert.equal(assetPayment.debitAccountId,'210002');assert.equal(assetPayment.creditAccountId,'100002');assert.equal(assetPayment.cashActivity,'INVESTING');
 await assert.rejects(nativePayment(146,saleObligation,false,99),/REPORTING_PAYMENT_ALLOCATION_REQUIRED/);
 const badObligation=await nativeOrigin(150,false,461);
 await assert.rejects(nativePayment(165,badObligation),/REPORTING_ASSET_SOURCE_RESOLUTION_REQUIRED/);
 assert.equal((await query('select id from financial_events where id=$1',[id(165)])).length,0);
 const reverseAsset={...event(id(166)),date:'2026-08-03',reversesEventId:id(125),lines:[{...event(id(166)).lines[0],recognitionSign:-1}]};
 await post(id(166),bankTwo,reverseAsset,'OUTFLOW');
 assert.equal((await saved(id(166)))[0].creditAccountId,'110001');assert.equal((await saved(id(166)))[0].cashActivity,'INVESTING');
 // A loss charged to a different receivable must not silently pick either account.
 await approve(id(170),id(102),[rule('110002'),refundRule,genericPayable,...lifecycleRules.map(r=>r.classificationId.endsWith(':SALE_LOSS')?{...r,creditAccountId:'110002'}:r),...purchaseRules]);
 const ambiguousObligation=await nativeOrigin(180);
 await assert.rejects(nativePayment(195,ambiguousObligation),/REPORTING_PAYMENT_ALLOCATION_REQUIRED/);
 assert.deepEqual((await saved(id(125)))[0],assetCollection);
 const assetDelta={description:'Preserve recorded native asset net obligation and selected bank on new settlements.',removals:[],upserts:(await query(catalog)).filter(r=>/^private\.financial_(resolve_native_asset_payment|capture_actual_posting)\(/.test(r.object_key))};
 assert.equal(assetDelta.upserts.length,2);
 const assetDeltaPath='tests/migration-history/native-asset-settlement-schema-delta.json';
 if(process.argv.includes('--write-asset-delta'))await writeFile(assetDeltaPath,JSON.stringify(assetDelta,null,2)+'\n');
 else assert.deepEqual(JSON.parse(await readFile(assetDeltaPath,'utf8')),assetDelta);
 console.log('PASS: native asset sale net of loss/VAT, acquisition including VAT, partial payment, original subaccounts, selected bank, reversal, ambiguity and reconciliation refusal');
 await db.exec('alter table financial_event_obligation_allocations add column source_advance_obligation_id uuid');
 await db.exec(await readFile('supabase/migrations/20261109175809_preserve_advance_application_accounts.sql','utf8'));
 for(const [index,code,root] of [[200,'130001','1300'],[201,'240001','2400']])await sql('insert into financial_chart_custom_accounts values($1,$2,$3,$4,$4,true,true,$3,$3)',[id(index),org,code,root]);
 const advanceRules=[{...rule(),sourceModule:'ADVANCE_WORKSPACE',classificationId:'supplier-advance:BASE',cashDirection:'OUTFLOW',debitAccountId:'130001',creditAccountId:'1000'},
 {...rule(),sourceModule:'ADVANCE_WORKSPACE',classificationId:'customer-advance:BASE',debitAccountId:'1000',creditAccountId:'240001'}];
 await approve(id(202),id(170),[rule('110002'),refundRule,genericPayable,...advanceRules]);
 for(const [n,supplier] of [[203,true],[205,false]]){
  const direction=supplier?'OUTFLOW':'INFLOW';
  await post(id(n),bank,{...event(id(n)),sourceModule:'ADVANCE_WORKSPACE',lines:[{...event(id(n)).lines[0],classificationId:supplier?'supplier-advance:BASE':'customer-advance:BASE',cashDirection:direction}]},direction);
  await sql('insert into financial_event_obligations values($1,$2,$3,$4,100)',[id(n+1),org,id(n),supplier?'SUPPLIER_ADVANCE':'CUSTOMER_ADVANCE']);
 }
 await sql('update financial_event_obligations set settleable_base_amount=300 where id=$1',[id(63)]);
 async function applyAdvance(n,supplier=true,amount=50,allocated=amount){
  const raw={...event(id(n)),eventType:'ADJUSTMENT',sourceModule:'ADVANCE_WORKSPACE',date:'2026-08-03',lines:[{...event(id(n)).lines[0],classificationId:supplier?'supplier-clearing:BASE':'customer-clearing:BASE',cashDirection:'NON_CASH',baseAmount:String(amount)}]};
  await db.transaction(async tx=>{
   await tx.query('insert into source_events values($1,$2)',[id(n),JSON.stringify(raw)]);
   await tx.query("insert into financial_event_obligation_allocations values($1,$2,$3,'ADVANCE_APPLICATION',$4,$5)",[org,id(n),supplier?id(131):id(63),allocated,supplier?id(204):id(206)]);
   await tx.query("insert into financial_events(id,organization_id,event_date,status) values($1,$2,'2026-08-03','ACTUAL')",[id(n),org]);
  });return raw;
 }
 const supplierApplication=await applyAdvance(207);
 const customerApplication=await applyAdvance(208,false);
 assert.equal((await saved(id(207)))[0].debitAccountId,'210002');assert.equal((await saved(id(207)))[0].creditAccountId,'130001');
 assert.equal((await saved(id(208)))[0].debitAccountId,'240001');assert.equal((await saved(id(208)))[0].creditAccountId,'110001');
 assert.equal((await query('select count(*)::int n from liquidity_settlements where financial_event_id in ($1,$2)',[id(207),id(208)]))[0].n,0);
 await assert.rejects(applyAdvance(209,true,50,49),/REPORTING_PAYMENT_ALLOCATION_REQUIRED/);
 assert.equal((await query('select count(*)::int n from financial_events where id=$1',[id(209)]))[0].n,0);
 const reverseAdvance={...supplierApplication,id:id(210),date:'2026-08-04',reversesEventId:id(207),lines:supplierApplication.lines.map(l=>({...l,id:id(210)+':BASE',recognitionSign:-1}))};
 await post(id(210),null,reverseAdvance);
 assert.equal((await saved(id(210)))[0].debitAccountId,'210002');assert.equal((await saved(id(210)))[0].creditAccountId,'130001');
 await sql('update financial_event_obligations set settleable_base_amount=99 where id=$1',[id(204)]);
 await assert.rejects(applyAdvance(211),/REPORTING_OBLIGATION_SOURCE_REQUIRED/);
 const advanceDelta={description:'Resolve new advance application from original recorded advance and invoice leaves.',removals:[],upserts:(await query(catalog)).filter(r=>/^private\.financial_(original_obligation_account|advance_application_rules|capture_actual_posting)\(/.test(r.object_key))};
 assert.equal(advanceDelta.upserts.length,3);
 const advanceDeltaPath='tests/migration-history/advance-application-schema-delta.json';
 if(process.argv.includes('--write-advance-delta'))await writeFile(advanceDeltaPath,JSON.stringify(advanceDelta,null,2)+'\n');
 else assert.deepEqual(JSON.parse(await readFile(advanceDeltaPath,'utf8')),advanceDelta);
 console.log('PASS: supplier/customer advance applications preserve original invoice and advance leaves; partial noncash clearing, reversal, amount mismatch and source reconciliation refusal');
 await db.exec('alter table financial_event_lines add column id uuid,add column metadata jsonb');
 await db.exec(await readFile('supabase/migrations/20261109180032_finance_installment_posting_parts.sql','utf8'));
 for(const [n,code,root] of [[220,'220001','2200'],[221,'710001','7100']])await sql('insert into financial_chart_custom_accounts values($1,$2,$3,$4,$4,true,true,$3,$3)',[id(n),org,code,root]);
 const principalRule={...rule(),eventType:'ADJUSTMENT',sourceModule:'DEBT_CONTRACTS',classificationId:'loan:BASE',debitAccountId:'1000',creditAccountId:'220001',cashActivity:'FINANCING'};
 const chargeRule={...rule(),eventType:'EXPENSE',sourceModule:'FINANCE_CONTRACTS',classificationId:'charge:BASE',cashDirection:'NON_CASH',debitAccountId:'710001',creditAccountId:'210002'};
 await approve(id(222),id(202),[rule('110002'),refundRule,genericPayable,principalRule,chargeRule]);
 const contract=id(223);
 for(const [n,r,amount] of [[224,principalRule,100],[225,chargeRule,20]]){
  await post(id(n),n===224?bank:null,{...event(id(n)),eventType:r.eventType,sourceModule:r.sourceModule,lines:[{...event(id(n)).lines[0],classificationId:r.classificationId,cashDirection:r.cashDirection,baseAmount:String(amount)}]});
  await sql('update financial_events set source_module=$1,event_type=$2,source_record_id=$3 where id=$4',[r.sourceModule,r.eventType,contract,id(n)]);
 }
 await sql("insert into financial_event_obligations values($1,$4,$5,'PAYABLE',50),($2,$4,$5,'PAYABLE',50),($3,$4,$6,'PAYABLE',20)",[id(226),id(227),id(228),org,id(224),id(225)]);
 async function installment(n,badRole=false,receivable=false,badAmount=false){
  const parts=[['FINANCE_PRINCIPAL_PAYMENT',receivable?id(286):id(226),40],['FINANCE_CHARGE_PAYMENT',receivable?id(288):id(228),20]];
  const direction=receivable?'INFLOW':'OUTFLOW';
  const raw={...event(id(n)),date:'2026-08-03',lines:parts.map(([role,ob,amount],i)=>({id:id(n+10+i)+':'+role,classificationId:(receivable?'receivable:':'payable:')+role,cashDirection:direction,recognitionSign:1,baseAmount:String(badAmount&&i===0?Number(amount)+1:amount)}))};
  await db.transaction(async tx=>{
   await tx.query('insert into source_events values($1,$2)',[id(n),JSON.stringify(raw)]);
   await tx.query("insert into liquidity_settlements values($1,$2,$3,'POSTED',$4,$5)",[org,id(n),bankTwo,direction,badAmount?61:60]);
   for(const [i,[role,ob,amount]] of parts.entries()){
    await tx.query("insert into financial_event_obligation_allocations values($1,$2,$3,'PAYMENT',$4,null)",[org,id(n),ob,amount]);
    await tx.query('insert into financial_event_lines(organization_id,event_id,classification_id,id,metadata) values($1,$2,$3,$4,$5)',[org,id(n),id(46),id(n+10+i),JSON.stringify({source_role:badRole&&i===0?'WRONG':role,settlement_obligation_id:ob})]);
   }
   await tx.query("insert into financial_events(id,organization_id,event_date,status,source_module,source_record_id,source_event_key,event_type) values($1,$2,'2026-08-03','ACTUAL','OPERATIONAL_CONSOLE',$3,$4,'SETTLEMENT')",[id(n),org,receivable?id(283):contract,'financing-installment:'+(receivable?id(283):contract)+':1:'+id(n)]);
  });return raw;
 }
 const installmentRaw=await installment(230);
 const installmentLegs=await saved(id(230));
 assert.deepEqual(installmentLegs.map(l=>[l.debitAccountId,l.creditAccountId,l.cashActivity]),[['220001','100002','FINANCING'],['210002','100002','OPERATING']]);
 await assert.rejects(installment(250,true),/REPORTING_FINANCE_COMPONENTS_REQUIRED/);
 assert.equal((await query('select count(*)::int n from financial_events where id=$1',[id(250)]))[0].n,0);
 const reverseInstallment={...installmentRaw,id:id(270),date:'2026-08-04',reversesEventId:id(230),lines:installmentRaw.lines.map((l,i)=>({...l,id:id(271+i)+':'+l.classificationId.split(':')[1],recognitionSign:-1}))};
 await db.transaction(async tx=>{
  await tx.query('insert into source_events values($1,$2)',[id(270),JSON.stringify(reverseInstallment)]);
  await tx.query("insert into liquidity_settlements values($1,$2,$3,'POSTED','INFLOW',60)",[org,id(270),bankTwo]);
  await tx.query("insert into financial_events(id,organization_id,event_date,status) values($1,$2,'2026-08-04','ACTUAL')",[id(270),org]);
 });
 assert.deepEqual((await saved(id(270))).map(l=>[l.debitAccountId,l.creditAccountId]),[['220001','100002'],['210002','100002']]);
 await sql('insert into financial_chart_custom_accounts values($1,$2,$3,$4,$4,true,true,$3,$3)',[id(280),org,'120001','1200']);
 const receivablePrincipal={...principalRule,cashDirection:'OUTFLOW',debitAccountId:'120001',creditAccountId:'1000',cashActivity:'INVESTING'};
 const receivableCharge={...chargeRule,eventType:'REVENUE',debitAccountId:'110001',creditAccountId:'410001'};
 await approve(id(282),id(222),[rule('110002'),refundRule,genericPayable,receivablePrincipal,receivableCharge]);
 for(const [n,r,amount] of [[284,receivablePrincipal,100],[285,receivableCharge,20]]){
  await post(id(n),n===284?bank:null,{...event(id(n)),eventType:r.eventType,sourceModule:r.sourceModule,lines:[{...event(id(n)).lines[0],classificationId:r.classificationId,cashDirection:r.cashDirection,baseAmount:String(amount)}]},'OUTFLOW');
  await sql('update financial_events set source_module=$1,event_type=$2,source_record_id=$3 where id=$4',[r.sourceModule,r.eventType,id(283),id(n)]);
 }
 await sql("insert into financial_event_obligations values($1,$4,$5,'RECEIVABLE',50),($2,$4,$5,'RECEIVABLE',50),($3,$4,$6,'RECEIVABLE',20)",[id(286),id(287),id(288),org,id(284),id(285)]);
 await installment(290,false,true);
 assert.deepEqual((await saved(id(290))).map(l=>[l.debitAccountId,l.creditAccountId,l.cashActivity]),[['100002','120001','INVESTING'],['100002','110001','OPERATING']]);
 await assert.rejects(installment(310,false,false,true),/REPORTING_FINANCE_COMPONENTS_REQUIRED/);
 await assert.rejects(query('select private.financial_original_obligation_account($1,$2)',[other,id(226)]),/REPORTING_OBLIGATION_SOURCE_REQUIRED/);
 const financeDelta={description:'Split new financing payments by original principal and accrued charge accounts.',removals:[],upserts:(await query(catalog)).filter(r=>/^private\.financial_(installment_posting_rules|capture_actual_posting)\(/.test(r.object_key))};
 assert.equal(financeDelta.upserts.length,2);
 const financeDeltaPath='tests/migration-history/finance-installment-posting-schema-delta.json';
 if(process.argv.includes('--write-finance-delta'))await writeFile(financeDeltaPath,JSON.stringify(financeDelta,null,2)+'\n');
 else assert.deepEqual(JSON.parse(await readFile(financeDeltaPath,'utf8')),financeDelta);
 console.log('PASS: financing principal and accrued cost clear separate original leaves, preserve selected bank/cash activities, reject mismatched source components, reverse both saved legs');
 const debtOpsSql=await readFile('supabase/migrations/20261109183825_debt_refund_and_schedule_posting.sql','utf8');
 await db.exec(`create table debt_operation_requests(id uuid default gen_random_uuid(),organization_id uuid,financial_event_id uuid,target_id uuid,kind text,execution_state text);
 alter table financial_event_lines add column cash_direction text;
 alter table financial_event_obligations add column adjusts_obligation_id uuid,add column adjustment_effect text;`);
 await db.exec(debtOpsSql.split('-- BEGIN DEBT OPERATION POSTING')[1].split('-- END DEBT OPERATION POSTING')[0]);
 await sql('update financial_event_obligations set settleable_base_amount=100 where id=$1',[id(204)]);
 async function refund(n,supplier=true,mismatch=false){
  const role=supplier?'DEBT_REFUND_SUPPLIER_ADVANCE':'DEBT_REFUND_CUSTOMER_ADVANCE',direction=supplier?'INFLOW':'OUTFLOW';
  const raw={...event(id(n)),sourceModule:'DEBT_OPERATIONS',date:'2026-08-05',lines:[{...event(id(n)).lines[0],classificationId:'clearing:'+role,cashDirection:direction,baseAmount:'25'}]};
  await db.transaction(async tx=>{
   await tx.query('insert into source_events values($1,$2)',[id(n),JSON.stringify(raw)]);
   await tx.query("insert into liquidity_settlements values($1,$2,$3,'POSTED',$4,25)",[org,id(n),bankTwo,direction]);
   await tx.query("insert into debt_operation_requests(organization_id,financial_event_id,target_id,kind,execution_state) values($1,$2,$3,'REFUND','EXECUTED')",[org,id(n),supplier?id(204):id(206)]);
   await tx.query("insert into financial_event_obligations values($1,$2,$3,$4,$5,$6,'DECREASE')",[id(n+1),org,id(n),supplier?'SUPPLIER_ADVANCE':'CUSTOMER_ADVANCE',mismatch?24:25,supplier?id(204):id(206)]);
   await tx.query("insert into financial_events(id,organization_id,event_date,status,source_module,event_type) values($1,$2,'2026-08-05','ACTUAL','DEBT_OPERATIONS','SETTLEMENT')",[id(n),org]);
  });return raw;
 }
 const refundRaw=await refund(330);await refund(340,false);
 assert.deepEqual((await saved(id(330))).map(l=>[l.debitAccountId,l.creditAccountId]),[['100002','130001']]);
 assert.deepEqual((await saved(id(340))).map(l=>[l.debitAccountId,l.creditAccountId]),[['240001','100002']]);
 await assert.rejects(refund(350,true,true),/REPORTING_REFUND_SOURCE_REQUIRED/);
 await db.transaction(async tx=>{
  const raw={...refundRaw,id:id(360),date:'2026-08-06',lines:refundRaw.lines.map(l=>({...l,id:id(360)+':BASE',recognitionSign:-1}))};
  await tx.query('insert into source_events values($1,$2)',[id(360),JSON.stringify(raw)]);
  await tx.query("insert into financial_event_links(organization_id,event_id,related_event_id,link_type) values($1,$2,$3,'REVERSAL_OF')",[org,id(360),id(330)]);
  await tx.query("insert into liquidity_settlements values($1,$2,$3,'POSTED','OUTFLOW',25)",[org,id(360),bankTwo]);
  await tx.query("insert into financial_events(id,organization_id,event_date,status) values($1,$2,'2026-08-06','ACTUAL')",[id(360),org]);
 });assert.equal((await saved(id(360)))[0].creditAccountId,'130001');
 // Execute the real normalizer on isolated late-year rows, not the source stub.
 await db.exec(`create table asset_accounts(id uuid,organization_id uuid,asset_type text);
 create table transactions(id uuid,asset_account_id uuid,organization_id uuid,transaction_date date,metadata jsonb);
 alter table financial_event_links add column target_module text,add column target_record_id uuid;
 alter table financial_events add column base_currency text default 'SAR';
 alter table financial_event_lines add column line_number int default 1,add column amount numeric default 100,
 add column base_amount numeric default 100,add column exchange_rate numeric default 1,add column vat_amount numeric default 0,add column recoverable_percent numeric default 100;
 alter table financial_event_obligations add column obligation_key text;
 create function private.financial_reporting_legacy_events(uuid,date,date) returns jsonb language sql as $$select '[]'::jsonb$$;`);
 const actualNormalizer=await readFile('supabase/migrations/20261103195100_financial_opening_refund_transfer.sql','utf8');
 await db.exec(actualNormalizer.slice(actualNormalizer.indexOf('create or replace function private.financial_reporting_events(')));
 await db.exec(debtOpsSql.split('-- BEGIN RESCHEDULE NORMALIZATION')[1].split('-- END RESCHEDULE NORMALIZATION')[0]);
 await db.transaction(async tx=>{
  await tx.query("insert into debt_operation_requests(organization_id,financial_event_id,target_id,kind,execution_state) values($1,$2,$3,'RESCHEDULE','EXECUTED')",[org,id(370),contract]);
  await tx.query("insert into financial_event_lines(organization_id,event_id,id,classification_id,metadata,cash_direction) values($1,$2,$3,$4,'{\"source_role\":\"DEBT_RESCHEDULE\"}','NON_CASH')",[org,id(370),id(371),id(46)]);
  await tx.query("insert into financial_events(id,organization_id,event_date,status,source_module,event_type) values($1,$2,'2026-12-01','ACTUAL','DEBT_OPERATIONS','ADJUSTMENT')",[id(370),org]);
 });
 assert.equal(await saved(id(370)),undefined);
 assert.deepEqual((await query("select private.financial_reporting_events($1,'2026-12-01','2026-12-01') result",[org]))[0].result,[]);
 // A marker without an executed request must not hide an accounting event.
 await sql("insert into financial_events(id,organization_id,event_date,status,source_module,event_type) values($1,$2,'2026-12-02','DRAFT','DEBT_OPERATIONS','ADJUSTMENT')",[id(380),org]);
 await sql("insert into financial_event_lines(organization_id,event_id,id,classification_id,metadata,cash_direction) values($1,$2,$3,$4,'{\"source_role\":\"DEBT_RESCHEDULE\"}','NON_CASH')",[org,id(380),id(381),id(46)]);
 assert.equal((await query('select private.financial_nonposting_reschedule($1,$2) result',[org,id(380)]))[0].result,false);
 const debtOpsDelta={description:'Original-account refunds and verified new nonposting reschedules.',removals:[],upserts:(await query(catalog)).filter(r=>/^private\.financial_(debt_refund_rules|nonposting_reschedule|capture_actual_posting|reporting_events)\(/.test(r.object_key))};assert.equal(debtOpsDelta.upserts.length,4);
 const debtOpsPath='tests/migration-history/debt-operations-posting-schema-delta.json';
 if(process.argv.includes('--write-debt-ops-delta'))await writeFile(debtOpsPath,JSON.stringify(debtOpsDelta,null,2)+'\n');else assert.deepEqual(JSON.parse(await readFile(debtOpsPath,'utf8')),debtOpsDelta);
 console.log('PASS: supplier/customer refunds, original leaf and selected bank, reversal, mismatched adjustment refusal; real normalizer excludes only verified new nonposting reschedules');
 console.log('PASS: inherited revenue collection and tax payment preserve original subaccounts, selected banks and reversal snapshots');
 console.log('PASS: new investment, asset and rent payments preserve the source payable, selected bank and investing/operating activity; rejects ambiguous allocations.');
 console.log('PASS: detail rules, receipt and payment bank UUID routing, atomic refusal, preserved policy versions, reversal and closing trial');
}catch(error){console.error(error.message,error.where??'');process.exitCode=1;}finally{await db.close();}
