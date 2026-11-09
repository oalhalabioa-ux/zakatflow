import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
const {PGlite}=await import(process.env.FISCAL_POSTGRES_TEST_MODULE);
const db=new PGlite();
const org='80000000-0000-4000-8000-000000000001';
try{
 await db.exec(`create role anon;create role authenticated;create schema private;create schema auth;
 create function auth.uid() returns uuid language sql as $$select '${org}'::uuid$$;
 create table financial_chart_custom_accounts(organization_id uuid,code text,reporting_code text,name_ar text,name_en text,is_active boolean,is_postable boolean,normal_side text);
 create table financial_classifications(id uuid primary key default gen_random_uuid(),organization_id uuid,code text,name text,classification_type text,is_system boolean,created_by uuid,active boolean default true,metadata jsonb default '{}',unique(organization_id,code));
 create table liquidity_flow_categories(organization_id uuid,code text,name_ar text,name_en text,flow_group text,allowed_direction text,is_system boolean,accounting_group text,treatment_code text,financial_classification_type text,expense_classification_id uuid,active boolean default true,unique(organization_id,code));
 create table financial_reporting_policies(id uuid default gen_random_uuid(),organization_id uuid,fiscal_start date,status text,version integer,rules jsonb);
 create table financial_year_closures(organization_id uuid,fiscal_start date,status text);
 create function private.financial_assert_open_period(uuid,date) returns void language plpgsql as $$begin
 if exists(select 1 from public.financial_year_closures where organization_id=$1 and fiscal_start=$2 and status='CLOSED')then raise exception 'FISCAL_PERIOD_CLOSED';end if;end$$;
 create function public.save_financial_reporting_policy(uuid,date,integer,jsonb,text) returns jsonb language plpgsql as $$begin
 if $3=0 then insert into public.financial_reporting_policies values(gen_random_uuid(),$1,$2,'DRAFT',1,$4);
 else update public.financial_reporting_policies set rules=$4,version=version+1 where organization_id=$1 and fiscal_start=$2 and status='DRAFT' and version=$3;
 end if;return '{}'::jsonb;end$$;`);
 await db.exec(await readFile('supabase/migrations/20261109141140_automatic_expense_account_setup.sql','utf8'));
 const query=async(s,p=[]) => (await db.query(s,p)).rows;
 const add=code=>query("insert into financial_chart_custom_accounts values($1,$2,'6100','إيجار','Rent',true,true,'DEBIT')",[org,code]);
 const generic=(await query("insert into financial_classifications(organization_id,code,name,classification_type) values($1,'OPEX','Expenses','OPEX') returning id",[org]))[0].id;
 const rule={eventType:'EXPENSE',sourceModule:'OPERATIONAL_CONSOLE',classificationId:generic+':BASE',cashDirection:'NON_CASH',debitAccountId:'610001',creditAccountId:'210002',detailed:true};
 await query("insert into public.financial_reporting_policies values(gen_random_uuid(),$1,'2026-01-01','APPROVED',1,$2)",[org,JSON.stringify([rule])]);
 await query("insert into public.financial_reporting_policies values(gen_random_uuid(),$1,'2025-01-01','APPROVED',1,$2)",[org,JSON.stringify([rule])]);
 await query("insert into financial_year_closures values($1,'2025-01-01','CLOSED')",[org]);
 await add('610002');
 const policies=await query("select * from financial_reporting_policies order by fiscal_start,status");
 assert.equal(policies.length,3);
 const draft=policies.find(p=>p.status==='DRAFT');
 assert.equal(draft.rules[1].debitAccountId,'610002');
 assert.equal(draft.rules[1].creditAccountId,'210002');
 assert.deepEqual(policies.filter(p=>p.status==='APPROVED').map(p=>p.rules),[[rule],[rule]]);
 assert.equal((await query('select * from liquidity_flow_categories')).length,1);
 await add('610003');
 assert.equal((await query("select rules from financial_reporting_policies where status='DRAFT'"))[0].rules.length,3);
 await query("insert into financial_classifications(organization_id,code,name,classification_type,active) values($1,'OPEX_ACCOUNT_610004','Conflict','REVENUE',true)",[org]);
 await assert.rejects(add('610004'),/CHART_CLASSIFICATION_CONFLICT/);
 assert.equal((await query("select * from financial_chart_custom_accounts where code='610004'")).length,0);

 // Existing disabled accounts become usable without requiring a second insert.
 await query("insert into financial_chart_custom_accounts values($1,'610005','6100','Disabled','Disabled',false,true,'DEBIT')",[org]);
 assert.equal((await query("select * from financial_classifications where code='OPEX_ACCOUNT_610005'")).length,0);
 await query("update financial_chart_custom_accounts set is_active=true where organization_id=$1 and code='610005'",[org]);
 assert.equal((await query("select * from financial_classifications where code='OPEX_ACCOUNT_610005'")).length,1);
 const version=(await query("select version from financial_reporting_policies where status='DRAFT'"))[0].version;
 await query("update financial_chart_custom_accounts set is_active=true,is_postable=true where organization_id=$1 and code='610005'",[org]);
 assert.equal((await query("select version from financial_reporting_policies where status='DRAFT'"))[0].version,version);
 await query("insert into financial_chart_custom_accounts values($1,'610006','6100','Summary','Summary',true,false,'DEBIT')",[org]);
 await query("update financial_chart_custom_accounts set is_postable=true where organization_id=$1 and code='610006'",[org]);
 assert.equal((await query("select * from liquidity_flow_categories where code='OPEX_ACCOUNT_610006'")).length,1);

 const retained=(await query("select id from financial_classifications where code='OPEX_ACCOUNT_610005'"))[0].id;
 await query("update financial_chart_custom_accounts set is_active=false where organization_id=$1 and code='610005'",[org]);
 assert.equal((await query("select active from financial_classifications where id=$1",[retained]))[0].active,false);
 assert.equal((await query("select active from liquidity_flow_categories where code='OPEX_ACCOUNT_610005'"))[0].active,false);
 await query("update financial_chart_custom_accounts set is_active=true,name_ar='Renamed',name_en='Renamed' where organization_id=$1 and code='610005'",[org]);
 const restored=(await query("select id,active,name from financial_classifications where code='OPEX_ACCOUNT_610005'"))[0];
 assert.deepEqual(restored,{id:retained,active:true,name:'Renamed'});
 assert.equal((await query("select name_ar from liquidity_flow_categories where code='OPEX_ACCOUNT_610005'"))[0].name_ar,'Renamed');
 // Identical codes in a second tenant must create distinct classifications.
 const other='80000000-0000-4000-8000-000000000002';
 await query("insert into financial_chart_custom_accounts values($1,'610002','6100','Other','Other',true,true,'DEBIT')",[other]);
 const duplicates=await query("select id from financial_classifications where code='OPEX_ACCOUNT_610002'");
 assert.equal(duplicates.length,2);assert.notEqual(duplicates[0].id,duplicates[1].id);
 const catalog=(await readFile('tests/migration-history/catalog.sql','utf8')).trim().replace(/;$/,'');
 const rows=(await query(catalog)).filter(r=>r.object_key.includes('financial_prepare_expense_account'));
 assert.equal(rows.length,2);
 const delta={description:'Atomic expense account classification and draft rule preparation.',removals:[],upserts:rows};
 const path='tests/migration-history/automatic-expense-account-schema-delta.json';
 if(process.argv.includes('--write-delta'))await writeFile(path,JSON.stringify(delta,null,2)+'\n');
 else assert.deepEqual(delta,JSON.parse(await readFile(path,'utf8')));
 console.log('PASS expense account/category/rule atomic creation, inherited payable, approved and closed policy preservation, second account, activation, leaf conversion, idempotence, tenant isolation and conflict rollback');
}catch(error){console.error(error.message);process.exitCode=1;}finally{await db.close();}
