import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
const {PGlite}=await import(process.env.FISCAL_POSTGRES_TEST_MODULE);
const db=new PGlite();
const org='80000000-0000-4000-8000-000000000001';
const roots=['1000','1100','1200','1300','1400','1500','1590','1600','1700','1800','2100','2200','2300','2400','2500','3100','3200','3300','4100','5100','6100','6200','7100','8100'];
try{
 await db.exec(`create role anon;create role authenticated;create schema private;create schema auth;create schema extensions;
 set check_function_bodies=false;
 create function auth.uid() returns uuid language sql as $$select '${org}'::uuid$$;
 create function private.financial_opening_can(uuid,text) returns boolean language sql as $$select $1='${org}'::uuid$$;
 create table financial_chart_custom_accounts(organization_id uuid,code text,reporting_code text,parent_code text,name_ar text,name_en text,is_active boolean,is_postable boolean,normal_side text,unique(organization_id,code));
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
 const sources=JSON.parse(await readFile('tests/migration-history/account-inheritance-source-functions.json','utf8'));
 for(const source of sources)await db.exec(source.definition);
 await db.exec(await readFile('supabase/migrations/20261109151753_automatic_account_rule_inheritance.sql','utf8'));
 const query=async(s,p=[]) => (await db.query(s,p)).rows;
 const base=(await query("insert into financial_classifications(organization_id,code,name,classification_type,is_system) values($1,'OTHER','Template','OTHER',true) returning id",[org]))[0].id;
 const templates=roots.filter(r=>!['1000','3300','6100'].includes(r)).map(root=>({eventType:'ADJUSTMENT',sourceModule:'TEST_'+root,classificationId:base+':BASE',cashDirection:'NON_CASH',debitAccountId:root,creditAccountId:root==='2100'?'1100':'2100'}));
 await query("insert into financial_reporting_policies values(gen_random_uuid(),$1,'2026-01-01','APPROVED',1,$2),(gen_random_uuid(),$1,'2025-01-01','APPROVED',1,$2)",[org,JSON.stringify(templates)]);
 await query("insert into financial_year_closures values($1,'2025-01-01','CLOSED')",[org]);
 for(const root of roots){
  await query("insert into financial_chart_custom_accounts values($1,$2,$3,$3,$2,$2,true,true,$4)",[org,root+'01',root,['1590','2100','2200','2300','2400','2500','3100','3200','4100'].includes(root)?'CREDIT':'DEBIT']);
  const generated=await query("select * from financial_classifications where organization_id=$1 and code=$2",[org,'OTHER_ACCOUNT_'+root+'01']);
  if(['1000','3300','6100'].includes(root)){assert.equal(generated.length,0);continue;}
  assert.equal(generated.length,1,root);
  const rules=(await query("select rules from financial_reporting_policies where organization_id=$1 and status='DRAFT'",[org]))[0].rules;
  const rule=rules.find(r=>r.classificationId===generated[0].id+':BASE'&&r.sourceModule==='TEST_'+root);
  assert.equal(rule.debitAccountId,root+'01',root);assert.equal(rule.creditAccountId,root==='2100'?'1100':'2100');
 }
 const approved=await query("select rules from financial_reporting_policies where status='APPROVED'");
 assert.deepEqual(approved.map(p=>p.rules),[templates,templates]);
 const before=(await query("select version,rules from financial_reporting_policies where status='DRAFT'"))[0];
 await query('select prepare_financial_account_rule_links($1)',[org]);
 assert.deepEqual((await query("select version,rules from financial_reporting_policies where status='DRAFT'"))[0],before);
 await assert.rejects(query('select prepare_financial_account_rule_links($1)',['80000000-0000-4000-8000-000000000002']),/CHART_WRITE_DENIED/);
 await query("update financial_chart_custom_accounts set is_active=false where organization_id=$1 and code='150001'",[org]);
 assert.equal((await query("select active from financial_classifications where code='OTHER_ACCOUNT_150001'"))[0].active,false);
 await query("update financial_chart_custom_accounts set is_active=true,name_ar='Renamed' where organization_id=$1 and code='150001'",[org]);
 assert.equal((await query("select active from financial_classifications where code='OTHER_ACCOUNT_150001'"))[0].active,true);

 // Native revenue/capex templates create directly selectable Liquidity categories.
 const revenue=(await query("insert into financial_classifications(organization_id,code,name,classification_type,is_system) values($1,'REVENUE','Revenue','REVENUE',false) returning id",[org]))[0].id;
 const capex=(await query("insert into financial_classifications(organization_id,code,name,classification_type,is_system) values($1,'CAPEX','Assets','CAPEX',true) returning id",[org]))[0].id;
 const extraRules=[{eventType:'REVENUE',sourceModule:'OPERATIONAL_CONSOLE',classificationId:revenue+':BASE',cashDirection:'NON_CASH',debitAccountId:'110001',creditAccountId:'4100'},
  {eventType:'ASSET_PURCHASE',sourceModule:'OPERATIONAL_CONSOLE',classificationId:capex+':BASE',cashDirection:'NON_CASH',debitAccountId:'1500',creditAccountId:'210001'}];
 await query("update financial_reporting_policies set rules=rules||$1::jsonb where status='DRAFT'",[JSON.stringify(extraRules)]);
 await query('select prepare_financial_account_rule_links($1)',[org]);
 const categories=await query('select * from liquidity_flow_categories order by code');
 assert.equal(categories.length,2);
 assert.equal(categories.find(c=>c.financial_classification_type==='REVENUE').allowed_direction,'INFLOW');
 assert.equal(categories.find(c=>c.financial_classification_type==='CAPEX').allowed_direction,'OUTFLOW');
 assert.ok(categories.every(c=>c.name_ar.includes(' — ')&&c.name_en.includes(' — ')));
 await query("update financial_chart_custom_accounts set name_ar='Updated revenue',name_en='Updated revenue' where organization_id=$1 and code='410001'",[org]);
 const renamed=(await query("select name_ar from liquidity_flow_categories where financial_classification_type='REVENUE'"))[0];
 assert.equal(renamed.name_ar,'Updated revenue — Revenue');
 await db.exec('create trigger category_link_guard before insert or update on liquidity_flow_categories for each row execute function private.validate_liquidity_expense_classification()');
 const revenueCategory=categories.find(c=>c.financial_classification_type==='REVENUE');
 await assert.rejects(query("insert into liquidity_flow_categories(organization_id,code,financial_classification_type,expense_classification_id) values($1,'cross-scope','REVENUE',$2)",['80000000-0000-4000-8000-000000000002',revenueCategory.expense_classification_id]),/LIQUIDITY_EXPENSE_CLASSIFICATION_INVALID/);
 await assert.rejects(query("update liquidity_flow_categories set financial_classification_type='OPEX' where code=$1",[revenueCategory.code]),/LIQUIDITY_EXPENSE_CLASSIFICATION_INVALID/);
 assert.equal((await query("select has_function_privilege('anon','public.prepare_financial_account_rule_links(uuid)','EXECUTE') allowed"))[0].allowed,false);
 assert.equal((await query("select has_function_privilege('authenticated','private.financial_inherit_account_rules(uuid,text)','EXECUTE') allowed"))[0].allowed,false);
 // Native system classifications may have specific semantic codes rather than type names.
 const native=(await query("insert into financial_classifications(organization_id,code,name,classification_type,is_system) values($1,'DEBT_PRINCIPAL_ASSET','Loan principal','ASSET',true) returning id",[org]))[0].id;
 const nativeTemplate={eventType:'ADJUSTMENT',sourceModule:'DEBT_CONTRACTS',classificationId:native+':PRINCIPAL',cashDirection:'NON_CASH',debitAccountId:'1200',creditAccountId:'110001'};
 await query("update financial_reporting_policies set rules=rules||$1::jsonb where status='DRAFT'",[JSON.stringify([nativeTemplate])]);
 await query('select prepare_financial_account_rule_links($1)',[org]);
 const nativeChild=(await query("select id from financial_classifications where code='DEBT_PRINCIPAL_ASSET_ACCOUNT_120001'"))[0];
 assert.ok(nativeChild);
 const nativeRules=(await query("select rules from financial_reporting_policies where status='DRAFT'"))[0].rules;
 assert.deepEqual(nativeRules.find(r=>r.classificationId===nativeChild.id+':PRINCIPAL'),{...nativeTemplate,classificationId:nativeChild.id+':PRINCIPAL',debitAccountId:'120001'});
 const ambiguous={eventType:'ADJUSTMENT',sourceModule:'ASSET_LIFECYCLE',classificationId:base+':BASE',cashDirection:'NON_CASH',debitAccountId:'6200',creditAccountId:'159001'};
 await query("update financial_reporting_policies set rules=rules||$1::jsonb where status='DRAFT'",[JSON.stringify([ambiguous])]);
 await query('select prepare_financial_account_rule_links($1)',[org]);
 const guarded=(await query("select rules from financial_reporting_policies where status='DRAFT'"))[0].rules;
 assert.equal(guarded.filter(r=>r.sourceModule==='ASSET_LIFECYCLE').length,1,'Ambiguous lifecycle rule was propagated');
 // Deliberately occupied generated identifier must roll the whole account insert back.
 await query("insert into financial_classifications(organization_id,code,name,classification_type,is_system) values($1,'OTHER_ACCOUNT_150002','Conflict','OTHER',false)",[org]);
 await assert.rejects(query("insert into financial_chart_custom_accounts values($1,'150002','1500','1500','Conflict','Conflict',true,true,'DEBIT')",[org]),/CHART_CLASSIFICATION_CONFLICT/);
 assert.equal((await query("select * from financial_chart_custom_accounts where code='150002'")).length,0);
 for(const source of sources){
  const functions=await query("select pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname=$1 and p.proname=$2",[source.schema,source.name]);
  assert.equal(functions.length,1);
  assert.ok(functions[0].definition.includes("where not (metadata ? 'accountInheritance')"),source.name);
 }
 const catalog=(await readFile('tests/migration-history/catalog.sql','utf8')).trim().replace(/;$/,'');
 const rows=(await query(catalog)).filter(r=>r.object_key.includes('financial_resolve_manual_payment')||r.object_key.includes('validate_liquidity_expense_classification')||r.object_key.includes('financial_inherit_account_rules')||r.object_key.includes('financial_account_rule_inheritance')||r.object_key.includes('prepare_financial_account_rule_links')||sources.some(s=>r.object_key.startsWith(s.schema+'.'+s.name+'(')));
 assert.equal(rows.length,16);
 const delta={description:'Account rule inheritance and source factory classification isolation.',removals:[],upserts:rows};
 const path='tests/migration-history/account-rule-inheritance-schema-delta.json';
 if(process.argv.includes('--write-delta'))await writeFile(path,JSON.stringify(delta,null,2)+'\n');
 else assert.deepEqual(delta,JSON.parse(await readFile(path,'utf8')));
 console.log('PASS 21 generic groups, 3 delegated groups, idempotence, permissions, historical policies, activation, conflict rollback and 10 source factory definitions');
}catch(error){console.error(error.message,error.where??'',error.position??'');process.exitCode=1;}finally{await db.close();}
