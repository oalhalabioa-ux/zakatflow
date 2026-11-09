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
  await tx.query("insert into financial_events values($1,$2,'2026-08-01','ACTUAL')",[eventId,org]);
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
 console.log('PASS: new investment, asset and rent payments preserve the source payable, selected bank and investing/operating activity; rejects ambiguous allocations.');
 console.log('PASS: detail rules, receipt and payment bank UUID routing, atomic refusal, preserved policy versions, reversal and closing trial');
}finally{await db.close();}
