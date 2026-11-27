import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {copyFile,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {verifyFiles} from './verify-files.mjs';

const dir=process.env.WORK02_UPGRADE_DIR;
assert.ok(dir&&process.env.RUNNER_TEMP&&dir===join(process.env.RUNNER_TEMP,'work02-after-personal-fx'));
const supabase=(...args)=>execFileSync('npx',['--yes','supabase@2.122.0',...args,'--workdir',dir],{encoding:'utf8'});
assert.equal(JSON.parse(supabase('status','--output','json')).API_URL,'http://127.0.0.1:54321');
const sql=input=>execFileSync('docker',['exec','-i','supabase_db_work02-after-personal-fx',
 'psql','-X','-q','-t','-A','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres'],
 {input,encoding:'utf8',stdio:['pipe','pipe','pipe'],maxBuffer:8*1024*1024}).trim();
const files=['20261126124000_atomic_chart_template.sql','20261126124100_fiscal_reversal_window.sql'];
const versions=files.map(file=>file.slice(0,14));
const fundingFile='20261126150000_personal_purchase_funding.sql';
const fundingVersion=fundingFile.slice(0,14);
const canonicalFx='20261125165000',installedFx='20261125201134';
const manifest=await verifyFiles();
const installed=()=>JSON.parse(sql("select jsonb_agg(version order by version) from supabase_migrations.schema_migrations"));
const expectedBefore=manifest.entries.map(entry=>entry.version===canonicalFx?installedFx:entry.version)
 .filter(version=>version<=versions.at(-1)&&!versions.includes(version)).sort();
assert.deepEqual(installed(),expectedBefore);
assert.equal(sql("select name from supabase_migrations.schema_migrations where version='"+installedFx+"'"),'personal_fx_rates');
assert.equal(sql("select to_regprocedure('public.apply_financial_chart_template(uuid,text,jsonb)') is null"),'t');

const owner=randomUUID(),org=randomUUID(),bank=randomUUID();
sql(`insert into auth.users(id,email,email_confirmed_at) values('${owner}','${owner}@work02-upgrade.invalid',now());
 select set_config('request.jwt.claim.sub','${owner}',false);
 insert into public.organizations(id,owner_user_id,name) values('${org}','${owner}','Synthetic post-FX upgrade');
 insert into public.organization_members(organization_id,user_id,role,status)
 values('${org}','${owner}','OWNER','ACTIVE') on conflict do nothing;
 insert into public.personal_fx_rates(user_id,from_currency,to_currency,valuation_date,rate,source)
 values('${owner}','SAR','USD','2024-01-01',0.25,'Private opening quote');
 insert into public.liquidity_accounts(id,organization_id,name,account_type,currency,current_balance,current_balance_base,created_by,metadata)
 values('${bank}','${org}','Existing bank','BANK','SAR',100,100,'${owner}',
 '{"opening_date":"2024-01-01","opening_balance":100,"opening_fx_rate":1}');
 select public.save_financial_fiscal_calendar('${org}',1,1,'3300',0,'Existing fiscal calendar');
 select public.save_financial_chart_account('${org}','610081','6100','مصروف قائم','Existing expense','DEBIT',true,true,0,'Existing chart leaf');
 do $fixture$
 declare workspace jsonb; saved jsonb; policy jsonb; entries jsonb;
 begin
  perform public.assign_financial_opening_source('${org}','liquidity_accounts','${bank}','2024-01-01','2024-01-01','1000',100,'Identify opening bank');
  workspace:=public.financial_opening_workspace('${org}','2024-01-01');
  select coalesce(jsonb_object_agg(row->>'id',jsonb_build_object('amount','0','side',row->>'normal')),'{}'::jsonb)
   into entries from jsonb_array_elements(workspace->'source'->'rows') row
   where jsonb_array_length(row->'vouchers')=0;
  entries:=jsonb_set(entries,'{equity:3100}','{"amount":"100","side":"CREDIT"}');
  saved:=public.save_financial_opening('${org}','2024-01-01',0,workspace->'source'->>'revision',entries,'Approve existing opening');
  saved:=public.approve_financial_opening((saved->>'id')::uuid,(saved->>'version')::int);
  if (select sum((row->>'debit')::numeric) from jsonb_array_elements(saved->'approved_opening') row) is distinct from 100::numeric then
   raise exception 'Unexpected fixture opening amount';
  end if;
  policy:=public.save_financial_reporting_policy('${org}','2024-01-01',0,'[]','Approve existing zero-activity policy');
  perform public.approve_financial_reporting_policy((policy->>'id')::uuid,(policy->>'version')::int);
 end $fixture$;`);
const evidence=()=>JSON.parse(sql(`select set_config('request.jwt.claim.sub','${owner}',false);
 select jsonb_build_object(
  'fx',(select to_jsonb(r) from public.personal_fx_rates r where r.user_id='${owner}'),
  'fxRecord',(select md5(to_jsonb(m)::text) from supabase_migrations.schema_migrations m where m.version='${installedFx}'),
  'chart',(select to_jsonb(c) from public.financial_chart_custom_accounts c where c.organization_id='${org}' and c.code='610081'),
  'opening',(select to_jsonb(o) from public.financial_opening_workspaces o where o.organization_id='${org}' and o.status='APPROVED'),
  'policy',(select to_jsonb(p) from public.financial_reporting_policies p where p.organization_id='${org}' and p.status='APPROVED'),
  'statement',public.financial_statement_live_snapshot('${org}','2024-01-01','2024-12-31')-'coverage'
 );`).split('\n').at(-1));
const before=evidence();
for(const value of Object.values(before))assert.ok(value,'Expected a persisted baseline record');

for(const file of files)await copyFile(join('supabase/migrations',file),join(dir,'supabase/migrations',file));
const expectedAfter=[...expectedBefore,...versions].sort();
for(let pass=0;pass<2;pass++){
 console.log(supabase('migration','up','--local'));
 assert.deepEqual(installed(),expectedAfter);
 assert.deepEqual(evidence(),before,'Upgrade altered the pre-existing FX, chart, approvals or official statement');
}
await sql(await readFile('tests/sql/personal-fx-rates.sql','utf8'));
assert.match(sql(await readFile('tests/sql/atomic-chart-template.sql','utf8')),/PASS atomic chart activation/);
const fiscal=JSON.parse(sql(await readFile('tests/qa-financial-opening-general-fiscal.sql','utf8')));
assert.ok(fiscal.checks.length>0&&fiscal.checks.every(check=>check.passed===true));
// Simulate the currently deployed purchase path before installing the forward-only fix.
const personal=randomUUID();
sql(`insert into auth.users(id,email,email_confirmed_at) values('${personal}','${personal}@funding-upgrade.invalid',now());
 begin;
 set local role authenticated;
 select set_config('request.jwt.claim.sub','${personal}',true);
 do $fixture$
 declare bank jsonb;
 begin
  bank:=public.create_asset_with_acquisition('{"name":"Upgrade funding","asset_type":"BANK","currency":"USD","metadata":{"quantity":200,"purchase_value":200,"purchase_date":"2026-01-01","fx_rate":4,"acquisition_mode":"OPENING_BALANCE"}}',gen_random_uuid());
  perform public.create_asset_with_acquisition(
   jsonb_build_object('name','Legacy funded purchase','asset_type','OTHER','currency','USD','metadata',
    jsonb_build_object('quantity',1,'purchase_value',100,'purchase_date','2026-02-01','fx_rate',3.75,
      'acquisition_mode','PURCHASE','funding_account_id',bank->>'id')),gen_random_uuid());
 end $fixture$;
 commit;`);
const historicalFunding=()=>JSON.parse(sql(`select jsonb_build_object(
 'assets',(select jsonb_agg(to_jsonb(a) order by id) from public.asset_accounts a where user_id='${personal}'),
 'lots',(select jsonb_agg(to_jsonb(l) order by id) from public.lots l where user_id='${personal}'),
 'transactions',(select jsonb_agg(to_jsonb(t) order by id) from public.transactions t where user_id='${personal}'),
 'allocations',(select jsonb_agg(to_jsonb(a) order by id) from public.transaction_allocations a where user_id='${personal}')
);`));
const legacy=historicalFunding();
assert.equal(legacy.transactions.find(row=>row.transaction_type==='WITHDRAWAL').quantity,93.75);
await copyFile(join('supabase/migrations',fundingFile),join(dir,'supabase/migrations',fundingFile));
for(let pass=0;pass<2;pass++){
 console.log(supabase('migration','up','--local'));
 assert.deepEqual(installed(),[...expectedAfter,fundingVersion].sort());
 assert.deepEqual(historicalFunding(),legacy,'The funding upgrade altered a previously posted purchase or its lots');
 assert.deepEqual(evidence(),before,'The funding upgrade altered the previously released financial scope');
}
const hawlFile='20261126175500_personal_first_hawl_start.sql';
const cycles=()=>sql("select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]') from zakat_hawl_cycles c");
sql(`insert into zakat_hawl_cycles(user_id,cycle_no,nisab_standard,nisab_reached_date,hawl_start_date,hawl_due_date,status)
 values('${personal}',1,'GOLD','2024-03-01','2024-03-01','2025-03-01','ACTIVE')`);
const priorCycles=cycles();
await copyFile(join('supabase/migrations',hawlFile),join(dir,'supabase/migrations',hawlFile));
for(let pass=0;pass<2;pass++){
 console.log(supabase('migration','up','--local'));
 assert.deepEqual(installed(),[...expectedAfter,fundingVersion,hawlFile.slice(0,14)].sort());
 assert.deepEqual(historicalFunding(),legacy);
 assert.deepEqual(evidence(),before);
 assert.equal(cycles(),priorCycles);
}
await writeFile('tests/migration-history/work02-upgrade-result.json',JSON.stringify({
 baselineFxVersion:installedFx,appliedVersions:[...versions,fundingVersion],secondApplyAddedNoMigrations:true,
 preservedExistingRecords:['personal FX rate and registry entry','chart account','approved opening','approved posting policy','official statement','linked legacy purchase, cash withdrawal and lot allocations'],
 postUpgradeChecks:['personal FX authorization and inverse opening quote','atomic chart activation and rollback','fiscal cutoff, close and next opening'],
},null,2)+'\n');
console.log('PASS Work 02 upgrade after the released personal FX migration');
