// Upgrade actual, already approved legacy records in a disposable loopback database.
import {execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const dir=process.env.OPENING_QA_WORKDIR;
assert.ok(dir&&process.env.RUNNER_TEMP&&dir.startsWith(process.env.RUNNER_TEMP+'/'),'DISPOSABLE_RUNNER_REQUIRED');
const migrations=[
 '20261104093720_general_fiscal_opening_engine.sql',
 '20261104113559_fiscal_future_draft_window.sql',
 '20261104121038_organization_chart_accounts.sql',
 '20261104124455_financial_chart_posting_rules.sql',
 '20261104132349_financial_chart_opening_leaf_link.sql',
 '20261104134551_financial_chart_posting_coverage.sql',
 '20261104165205_fiscal_calendar_budget_guards.sql',
 '20261104214000_funded_debt_source_cash_direction.sql',
 '20261104222828_unified_cash_account_openings.sql',
 '20261105010000_fiscal_retained_leaf_account.sql'
];
const sql=input=>execFileSync('docker',['exec','-i','supabase_db_opening-workspace-qa','psql','-X','-q','-t','-A','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres'],{input,encoding:'utf8',maxBuffer:8*1024*1024});
const out='docs/financial-reports/evidence-opening-live';await mkdir(out,{recursive:true});
assert.equal(sql("select to_regclass('public.financial_fiscal_calendars') is null").trim(),'t');
const fixture=JSON.parse(sql(`do $$
declare u uuid:=gen_random_uuid();org uuid:=gen_random_uuid();bank uuid:=gen_random_uuid();party uuid:=gen_random_uuid();pending_debt jsonb;s jsonb;w jsonb;p jsonb;
begin
 insert into auth.users(id,email,email_confirmed_at) values(u,u||'@upgrade.invalid',now());
 perform set_config('request.jwt.claim.sub',u::text,true);
 insert into public.organizations(id,owner_user_id,name) values(org,u,'ZZ preserved legacy upgrade fixture');
 insert into public.organization_members(organization_id,user_id,role,status) values(org,u,'OWNER','ACTIVE') on conflict(organization_id,user_id) do update set role='OWNER',status='ACTIVE';
 insert into public.liquidity_accounts(id,organization_id,name,account_type,currency,current_balance,current_balance_base,created_by,metadata)
 values(bank,org,'Legacy bank','BANK','SAR',100,100,u,'{"opening_date":"2023-12-31","opening_balance":100,"opening_fx_rate":1}');
 s:=public.financial_opening_workspace(org,'2024-01-01');
 w:=public.save_financial_opening(org,'2024-01-01',0,s->'source'->>'revision','{"equity:3100":{"amount":"100","side":"CREDIT"},"equity:3200":{"amount":"0","side":"CREDIT"},"equity:3300":{"amount":"0","side":"CREDIT"}}','Existing approved legacy opening');
 perform public.approve_financial_opening((w->>'id')::uuid,1);
 p:=public.save_financial_reporting_policy(org,'2024-01-01',0,'[]','Existing approved legacy rules');
 perform public.approve_financial_reporting_policy((p->>'id')::uuid,1);
 insert into public.liquidity_counterparties(id,organization_id,name,party_type,created_by) values(party,org,'Legacy loan party','CUSTOMER',u);
 pending_debt:=public.create_debt_contract(jsonb_build_object('organization_id',org,'request_id',gen_random_uuid(),
  'kind','LOAN','mode','NEW','side','RECEIVABLE','counterparty_id',party,'entity_id',null,'account_id',bank,
  'category','O_AR_LOAN','description','Legacy unapproved funded loan','reference','QA-LEGACY-FUND',
  'date','2024-01-05','currency','SAR','exchange_rate',1,'principal',50,
  'schedule',jsonb_build_array(jsonb_build_object('amount',50,'due_date','2024-12-01'))));
end $$;
select jsonb_build_object('org',o.id,'owner',o.owner_user_id,
 'pendingDebtId',(select id from public.debt_contracts where organization_id=o.id and reference='QA-LEGACY-FUND'),
 'pendingDebtEventId',(select financial_event_id from public.debt_contracts where organization_id=o.id and reference='QA-LEGACY-FUND'))
 from public.organizations o where name='ZZ preserved legacy upgrade fixture';`));
const {org,owner,pendingDebtId,pendingDebtEventId}=fixture;
const preserved=()=>JSON.parse(sql(`select jsonb_build_object(
 'organization',(select to_jsonb(o) from public.organizations o where id='${org}'),
 'members',(select jsonb_agg(to_jsonb(m) order by user_id) from public.organization_members m where organization_id='${org}'),
 'bank',(select jsonb_agg(to_jsonb(b) order by id) from public.liquidity_accounts b where organization_id='${org}'),
 'opening',(select jsonb_agg(to_jsonb(w) order by id) from public.financial_opening_workspaces w where organization_id='${org}'),
 'openingAudit',(select jsonb_agg(to_jsonb(a) order by a.id) from public.financial_opening_audit a join public.financial_opening_workspaces w on w.id=a.workspace_id where w.organization_id='${org}'),
 'policy',(select jsonb_agg(to_jsonb(p) order by id) from public.financial_reporting_policies p where organization_id='${org}'))`));
const snapshot=()=>JSON.parse(sql(`select set_config('request.jwt.claim.sub','${owner}',false);select public.financial_statement_live_snapshot('${org}','2024-01-01','2024-12-31')-'coverage'`).trim().split('\n').at(-1));
const before=preserved(),statementBefore=snapshot();
for(const migration of migrations) await writeFile(join(dir,'supabase/migrations',migration),await readFile('supabase/migrations/'+migration));
execFileSync('npx',['--yes','supabase@2.122.0','migration','up','--local','--workdir',dir],{stdio:'inherit'});
assert.deepEqual(preserved(),before,'Upgrade changed existing organization records or approvals');
assert.deepEqual(snapshot(),statementBefore,'Upgrade changed an existing approved statement');
sql(`select set_config('request.jwt.claim.sub','${owner}',false);select public.save_financial_chart_account('${org}','100001','1000','فرع نقدي تجريبي','Unmapped cash leaf','DEBIT',true,true,0,'Unmapped account must not rewrite an approved report')`);
assert.deepEqual(snapshot(),statementBefore,'An unreferenced chart leaf changed an earlier approved statement');
sql(`select set_config('request.jwt.claim.sub','${owner}',false);select public.save_financial_fiscal_calendar('${org}',1,1,'3300',0,'Adopt matching fiscal settings without rewriting legacy balances')`);
assert.deepEqual(snapshot(),statementBefore,'Explicit matching calendar changed the legacy statement');
// The old committed, unapproved source is intentionally unchanged by migration.
assert.equal(sql(`select cash_direction from public.financial_event_lines where event_id='${pendingDebtEventId}'`).trim(),'NON_CASH');
sql(`select set_config('request.jwt.claim.sub','${owner}',false);select public.approve_financial_event('${pendingDebtEventId}','QA legacy review only');`);
assert.throws(()=>sql(`select set_config('request.jwt.claim.sub','${owner}',false);select public.post_debt_contract('${pendingDebtId}');`),error=>String(error.stderr??'').includes('DEBT_FUNDING_REISSUE_REQUIRED'));
assert.equal(sql(`select status from public.financial_events where id='${pendingDebtEventId}'`).trim(),'COMMITTED');
assert.equal(sql(`select current_balance from public.liquidity_accounts where organization_id='${org}' and name='Legacy bank'`).trim(),'100.0000');
await writeFile(out+'/upgrade-compatibility.json',JSON.stringify({engine:'Pre-migration approved records, native CLI upgrade, exact record and statement comparison',productionConnections:false,checks:[{name:'Existing organization, members, bank, opening, approval audit and policy remain byte-equivalent',passed:true},{name:'Approved legacy statement remains identical after upgrade and matching calendar setup',passed:true}]},null,2)+'\n');
console.log('PASS existing approved legacy data survives the actual fiscal engine upgrade and calendar adoption');
