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
const canonicalFx='20261125165000',installedFx='20261125201134';
const manifest=await verifyFiles();
const installed=()=>JSON.parse(sql("select jsonb_agg(version order by version) from supabase_migrations.schema_migrations"));
const expectedBefore=manifest.entries.map(entry=>entry.version===canonicalFx?installedFx:entry.version)
 .filter(version=>!versions.includes(version)).sort();
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
 '{"opening_date":"2023-12-31","opening_balance":100,"opening_fx_rate":1}');
 select public.save_financial_fiscal_calendar('${org}',1,1,'3300',0,'Existing fiscal calendar');
 select public.save_financial_chart_account('${org}','610081','6100','مصروف قائم','Existing expense','DEBIT',true,true,0,'Existing chart leaf');
 do $fixture$
 declare workspace jsonb; saved jsonb; policy jsonb;
 begin
  workspace:=public.financial_opening_workspace('${org}','2024-01-01');
  saved:=public.save_financial_opening('${org}','2024-01-01',0,workspace->'source'->>'revision',
   '{"equity:3100":{"amount":"100","side":"CREDIT"},"equity:3200":{"amount":"0","side":"CREDIT"},"equity:3300":{"amount":"0","side":"CREDIT"}}','Approve existing opening');
  perform public.approve_financial_opening((saved->>'id')::uuid,(saved->>'version')::int);
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
await writeFile('tests/migration-history/work02-upgrade-result.json',JSON.stringify({
 baselineFxVersion:installedFx,appliedVersions:versions,secondApplyAddedNoMigrations:true,
 preservedExistingRecords:['personal FX rate and registry entry','chart account','approved opening','approved posting policy','official statement'],
 postUpgradeChecks:['personal FX authorization and inverse opening quote','atomic chart activation and rollback','fiscal cutoff, close and next opening'],
},null,2)+'\n');
console.log('PASS Work 02 upgrade after the released personal FX migration');
