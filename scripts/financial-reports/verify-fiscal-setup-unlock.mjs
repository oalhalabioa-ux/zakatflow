// Local PostgreSQL/WASM procedure regression; no hosted connection or credentials.
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const {PGlite}=await import(process.env.FISCAL_POSTGRES_TEST_MODULE);
const db=new PGlite();
const org='11111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222',other='33333333-3333-4333-8333-333333333333';
try{
 await db.exec(`create role anon;create role authenticated;create schema auth;create schema private;
 create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table public.organizations(id uuid primary key,owner_user_id uuid);
 create function private.financial_opening_can(org uuid,scope text) returns boolean language sql stable as $$select exists(select 1 from public.organizations where id=org and owner_user_id=auth.uid())$$;
 create table public.financial_opening_workspaces(organization_id uuid,fiscal_start date);
 create table public.financial_chart_custom_accounts(organization_id uuid,code text,reporting_code text,normal_side text,is_active boolean,is_postable boolean);
 create table public.financial_events(organization_id uuid,status text);
 create table public.transactions(organization_id uuid);
 create table public.liquidity_flows(organization_id uuid);
 create table public.liquidity_settlements(organization_id uuid);
 create table public.asset_accounts(organization_id uuid);
 create table public.liquidity_accounts(organization_id uuid);
 create table public.debt_contracts(organization_id uuid);
 create table public.budget_plans(id uuid,status text);
 create table public.financial_budget_plan_ownership(plan_id uuid,organization_id uuid,fiscal_start date,entity_id uuid,cost_center_id uuid);
 create function private.financial_reporting_events(org uuid,a date,b date) returns jsonb language sql stable as $$select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.transactions t where organization_id=org$$;
 `);
 const ledger=await readFile('supabase/migrations/20261103142726_financial_reporting_ledger.sql','utf8');
 await db.exec(ledger.slice(0,ledger.indexOf('create or replace function private.financial_reporting_events')));
 const engine=await readFile('supabase/migrations/20261104093720_general_fiscal_opening_engine.sql','utf8');
 await db.exec(engine.slice(0,engine.indexOf('alter table public.financial_opening_source_assignments add column')));
 const retained=await readFile('supabase/migrations/20261105010000_fiscal_retained_leaf_account.sql','utf8');
 await db.exec(retained.slice(0,retained.indexOf('-- A postable leaf')));
 await db.exec(`do $$declare d text;begin d:=pg_get_functiondef('public.save_financial_fiscal_calendar(uuid,integer,integer,text,integer,text)'::regprocedure);execute replace(d,'or not exists(select 1 from jsonb_array_elements(public.financial_reporting_chart()) a where a->>''code''=p_retained and a->>''kind''=''EQUITY'')','or not private.financial_retained_account_valid(p_org,p_retained)');end $$;`);
 await db.exec(await readFile('supabase/migrations/20261104165205_fiscal_calendar_budget_guards.sql','utf8'));
 await db.exec(await readFile('supabase/migrations/20261109090210_fiscal_setup_policy_unlock.sql','utf8'));
 await db.exec(`insert into auth.users values('${actor}');insert into organizations values('${org}','${actor}'),('${other}',null);select set_config('request.jwt.claim.sub','${actor}',false);insert into financial_chart_custom_accounts values('${org}','330001','3300','CREDIT',true,true);`);
 const query=async sql=>(await db.query(sql)).rows;
 const save=async(month,retained,version)=>query(`select save_financial_fiscal_calendar('${org}',${month},1,'${retained}',${version},'Reviewed setup correction') c`);
 await save(1,'3300',0);
 await db.exec(`insert into financial_reporting_policies(organization_id,fiscal_start,fiscal_end,currency,rules,status,created_by,updated_by,approved_by,approved_at,reason) values('${org}','2026-01-01','2026-12-31','SAR','[{"keep":"approved"}]','APPROVED','${actor}','${actor}','${actor}',now(),'Legacy approval'),('${org}','2026-01-01','2026-12-31','SAR','[{"keep":"draft"}]','DRAFT','${actor}','${actor}',null,null,'Current edits');`);
 assert.equal((await query(`select financial_fiscal_context('${org}') c`))[0].c.setupLockReason,null);
 await save(1,'330001',1); // Retained-only edit preserves policy approvals and identity.
 assert.equal((await query(`select count(*)::int n from financial_reporting_policies where status='APPROVED'`))[0].n,1);
 await save(7,'330001',2);
 const policies=await query(`select * from financial_reporting_policies order by created_at,id`);
 const draft=policies.find(p=>p.status==='DRAFT');assert.ok(draft);assert.equal(new Date(draft.fiscal_start).toISOString().slice(0,10),'2026-07-01');assert.equal(new Date(draft.fiscal_end).toISOString().slice(0,10),'2027-06-30');assert.deepEqual(draft.rules,[{keep:'draft'}]);assert.equal(draft.approved_at,null);assert.equal(policies.filter(p=>p.status==='SUPERSEDED').length,2);
 assert.equal((await query(`select count(*)::int n from financial_reporting_policy_audit where action='CALENDAR_REBASE'`))[0].n,2);
 await assert.rejects(save(1,'330001',2),/FISCAL_VERSION_CONFLICT/);
 await assert.rejects(query(`select save_financial_fiscal_calendar('${other}',1,1,'3300',0,'Denied user')`),/FISCAL_WRITE_DENIED/);
 await assert.rejects(save(1,'330099',3),/FISCAL_CALENDAR_INVALID/);
 const baseline=JSON.stringify(await query(`select * from financial_reporting_policies`));
 for(const [table,values,reason] of [['financial_events',`'${org}','ACTUAL'`,'ACTIVITY'],['transactions',`'${org}'`,'ACTIVITY'],['financial_opening_workspaces',`'${org}','2026-07-01'`,'OPENING_REVIEW'],['financial_budget_plan_ownership',`null,'${org}','2026-07-01',null,null`,'BUDGET_REVIEW']]){
  await db.exec(`insert into ${table} values(${values})`);
  assert.equal((await query(`select financial_fiscal_context('${org}') c`))[0].c.setupLockReason,reason);
  await assert.rejects(save(1,'330001',3),/FISCAL_CALENDAR_IN_USE/);
  assert.equal(JSON.stringify(await query(`select * from financial_reporting_policies`)),baseline,'Rejected save must not change rule history');
  await db.exec(`delete from ${table}`);
 }
 const exposed=await query(`select has_function_privilege('anon','private.financial_calendar_setup_lock(uuid)','execute') a,has_function_privilege('authenticated','private.financial_rebase_setup_policies(uuid,integer,integer,text)','execute') b`);assert.deepEqual(exposed,[{a:false,b:false}]);
 const calendar=(await query(`select * from financial_fiscal_calendars`))[0];assert.equal(calendar.version,3);assert.equal(calendar.start_month,7);
 const catalog=(await readFile('tests/migration-history/catalog.sql','utf8')).trim().replace(/;$/,'');
 const delta=await query(`select * from (${catalog}) c where category='function' and (object_key like 'private.financial_calendar_setup_lock(%' or object_key like 'private.financial_rebase_setup_policies(%' or object_key like 'public.save_financial_fiscal_calendar(%' or object_key like 'public.financial_fiscal_context(%') order by category,object_key`);
 if(process.argv.includes('--write-delta'))await writeFile('tests/migration-history/fiscal-setup-unlock-schema-delta.json',JSON.stringify({description:'Authorized pre-operation setup edits and audited posting-policy rebase; no migration-time data writes.',removals:[],upserts:delta},null,2)+'\n');
 console.log('PASS PostgreSQL: editable before operations, retained-only preservation, January/July rebase, preserved draft edits/history, no automatic approval, activity/opening/budget locks, invalid leaf, stale version, foreign tenant and atomic rejection.');
}finally{await db.close()}
