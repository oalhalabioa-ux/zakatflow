// Upgrade actual, already approved legacy records in a disposable loopback database.
import {execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const dir=process.env.OPENING_QA_WORKDIR;
assert.ok(dir&&process.env.RUNNER_TEMP&&dir.startsWith(process.env.RUNNER_TEMP+'/'),'DISPOSABLE_RUNNER_REQUIRED');
const migration='20261104093720_general_fiscal_opening_engine.sql';
const sql=input=>execFileSync('docker',['exec','-i','supabase_db_opening-workspace-qa','psql','-X','-q','-t','-A','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres'],{input,encoding:'utf8',maxBuffer:8*1024*1024});
const out='docs/financial-reports/evidence-opening-live';await mkdir(out,{recursive:true});
assert.equal(sql("select to_regclass('public.financial_fiscal_calendars') is null").trim(),'t');
const fixture=JSON.parse(sql(`do $$
declare u uuid:=gen_random_uuid();org uuid:=gen_random_uuid();bank uuid:=gen_random_uuid();s jsonb;w jsonb;p jsonb;
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
end $$;
select jsonb_build_object('org',o.id,'owner',o.owner_user_id) from public.organizations o where name='ZZ preserved legacy upgrade fixture';`));
const {org,owner}=fixture;
const preserved=()=>JSON.parse(sql(`select jsonb_build_object(
 'organization',(select to_jsonb(o) from public.organizations o where id='${org}'),
 'members',(select jsonb_agg(to_jsonb(m) order by user_id) from public.organization_members m where organization_id='${org}'),
 'bank',(select jsonb_agg(to_jsonb(b) order by id) from public.liquidity_accounts b where organization_id='${org}'),
 'opening',(select jsonb_agg(to_jsonb(w) order by id) from public.financial_opening_workspaces w where organization_id='${org}'),
 'openingAudit',(select jsonb_agg(to_jsonb(a) order by a.id) from public.financial_opening_audit a join public.financial_opening_workspaces w on w.id=a.workspace_id where w.organization_id='${org}'),
 'policy',(select jsonb_agg(to_jsonb(p) order by id) from public.financial_reporting_policies p where organization_id='${org}'))`));
const snapshot=()=>JSON.parse(sql(`select set_config('request.jwt.claim.sub','${owner}',false);select public.financial_statement_live_snapshot('${org}','2024-01-01','2024-12-31')-'coverage'`).trim().split('\n').at(-1));
const before=preserved(),statementBefore=snapshot();
await writeFile(join(dir,'supabase/migrations',migration),await readFile('supabase/migrations/'+migration));
execFileSync('npx',['--yes','supabase@2.122.0','migration','up','--local','--workdir',dir],{stdio:'inherit'});
assert.deepEqual(preserved(),before,'Upgrade changed existing organization records or approvals');
assert.deepEqual(snapshot(),statementBefore,'Upgrade changed an existing approved statement');
sql(`select set_config('request.jwt.claim.sub','${owner}',false);select public.save_financial_fiscal_calendar('${org}',1,1,'3300',0,'Adopt matching fiscal settings without rewriting legacy balances')`);
assert.deepEqual(snapshot(),statementBefore,'Explicit matching calendar changed the legacy statement');
await writeFile(out+'/upgrade-compatibility.json',JSON.stringify({engine:'Pre-migration approved records, native CLI upgrade, exact record and statement comparison',productionConnections:false,checks:[{name:'Existing organization, members, bank, opening, approval audit and policy remain byte-equivalent',passed:true},{name:'Approved legacy statement remains identical after upgrade and matching calendar setup',passed:true}]},null,2)+'\n');
console.log('PASS existing approved legacy data survives the actual fiscal engine upgrade and calendar adoption');
