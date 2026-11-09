import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const {PGlite}=await import(process.env.FISCAL_POSTGRES_TEST_MODULE);
const db=new PGlite();
const org='80000000-0000-4000-8000-000000000001';
const other='80000000-0000-4000-8000-000000000002';
try{
 await db.exec(`create role anon;create role authenticated;create schema private;create schema auth;
 create function auth.uid() returns uuid language sql as $$select '${org}'::uuid$$;
 create function private.financial_opening_can(uuid,text) returns boolean language sql as $$select $1='${org}'::uuid and coalesce(current_setting('test.deny',true),'')<>$2$$;
 create table organizations(id uuid primary key);insert into organizations values('${org}'),('${other}');
 create table financial_chart_custom_accounts(organization_id uuid,code text,parent_code text,reporting_code text,name_ar text,name_en text,normal_side text,is_active boolean,is_postable boolean,unique(organization_id,code));
 create table financial_reporting_policies(id uuid primary key default gen_random_uuid(),organization_id uuid,fiscal_start date,status text,version integer,rules jsonb,reason text);
 create function private.financial_assert_open_period(uuid,date) returns void language plpgsql as $$begin if $2<'2026-01-01' then raise exception 'FISCAL_PERIOD_CLOSED';end if;end$$;
 create function public.save_financial_chart_account(uuid,text,text,text,text,text,boolean,boolean,integer,text) returns jsonb language plpgsql as $$begin insert into public.financial_chart_custom_accounts values($1,$2,$3,$3,$4,$5,$6,$8,$7);return '{}'::jsonb;end$$;
 create function public.save_financial_reporting_policy(uuid,date,integer,jsonb,text) returns jsonb language plpgsql as $$declare p public.financial_reporting_policies%rowtype;begin
 if $3=0 then insert into public.financial_reporting_policies(organization_id,fiscal_start,status,version,rules,reason) values($1,$2,'DRAFT',1,$4,$5) returning * into p;
 else update public.financial_reporting_policies set rules=$4,reason=$5,version=version+1 where organization_id=$1 and fiscal_start=$2 and status='DRAFT' and version=$3 returning * into p;end if;
 return to_jsonb(p);end$$;
 create function public.approve_financial_reporting_policy(uuid,integer) returns jsonb language plpgsql as $$declare p public.financial_reporting_policies%rowtype;begin
 if current_setting('test.reject_approval',true)='yes' then raise exception 'REPORTING_SELF_APPROVAL_DENIED';end if;
 update public.financial_reporting_policies set status='SUPERSEDED' where organization_id='${org}' and status='APPROVED';
 update public.financial_reporting_policies set status='APPROVED',version=version+1 where id=$1 and version=$2 returning * into p;return to_jsonb(p);end$$;
 create function public.prepare_financial_account_rule_links(uuid) returns jsonb language sql as $$select '{}'::jsonb$$;
 `);
 // Exercise the actual detail-validation function, not a permissive fake.
 const detail=await readFile('supabase/migrations/20261109101216_detailed_posting_routing.sql','utf8');
 await db.exec(detail.slice(detail.indexOf('create function private.financial_assert_detailed_rules'),detail.indexOf('-- Identity is the actual settlement')));
 await db.exec(await readFile('supabase/migrations/20261109205527_ready_posting_defaults.sql','utf8'));
 const q=async(sql,args=[]) => (await db.query(sql,args)).rows;
 await q("insert into financial_chart_custom_accounts values($1,'110001','1100','1100','حساب آخر','Other account','DEBIT',true,true),($1,'210008','2100','2100','ذمم الموردين','Trade payables','CREDIT',true,true)",[org]);
 const roles=(await q("select prepare_financial_posting_defaults($1,'2026-01-01') roles",[org]))[0].roles;
 assert.equal(roles['1100'],'110002');assert.equal(roles['2100'],'210008');assert.notEqual(roles.EMPLOYEE,roles['1100']);assert.notEqual(roles['2200'],roles['2100']);
 const count=(await q('select count(*) n from financial_chart_custom_accounts'))[0].n;
 assert.deepEqual((await q("select prepare_financial_posting_defaults($1,'2026-01-01') roles",[org]))[0].roles,roles);
 assert.equal((await q('select count(*) n from financial_chart_custom_accounts'))[0].n,count);
 await assert.rejects(q("select prepare_financial_posting_defaults($1,'2026-01-01')",[other]),/REPORTING_SAVE_DENIED/);
 await assert.rejects(q("select prepare_financial_posting_defaults($1,'2025-01-01')",[org]),/FISCAL_PERIOD_CLOSED/);
 const rules=[{eventType:'REVENUE',sourceModule:'OPERATIONAL_CONSOLE',classificationId:'revenue:BASE',cashDirection:'NON_CASH',debitAccountId:roles['1100'],creditAccountId:roles['4100'],detailed:true}];
 const activate=(id,version,rs=rules)=>q("select activate_financial_posting_defaults($1,'2026-01-01',$2,$3,$4) p",[org,id,version,JSON.stringify(rs)]);
 await db.exec("set test.reject_approval='yes'");await assert.rejects(activate(null,0),/REPORTING_SELF_APPROVAL_DENIED/);
 assert.equal((await q('select count(*) n from financial_reporting_policies'))[0].n,0);
 await db.exec("set test.reject_approval='no'");
 const approved=(await activate(null,0))[0].p;assert.equal(approved.status,'APPROVED');
 assert.deepEqual((await activate(approved.id,approved.version))[0].p,approved);
 await assert.rejects(activate(approved.id,approved.version-1),/REPORTING_VERSION_CONFLICT/);
 await assert.rejects(activate(approved.id,approved.version,[{...rules[0],debitAccountId:'1100'}]),/REPORTING_DETAIL_ACCOUNT_REQUIRED/);
 await db.exec("set test.deny='financial_core.approve'");await assert.rejects(activate(approved.id,approved.version),/REPORTING_APPROVE_DENIED/);await db.exec("set test.deny=''");
 await q("update financial_chart_custom_accounts set is_active=false where organization_id=$1 and code=$2",[org,roles['1100']]);
 await assert.rejects(q("select prepare_financial_posting_defaults($1,'2026-01-01')",[org]),/REPORTING_DEFAULT_ROLE_INVALID/);
 assert.equal((await q("select has_function_privilege('anon','public.prepare_financial_posting_defaults(uuid,date)','execute') allowed"))[0].allowed,false);
 assert.equal((await q("select has_function_privilege('authenticated','private.financial_auto_activate_account_rules()','execute') allowed"))[0].allowed,false);
 console.log('PASS: role reuse, code collision, idempotency, tenant isolation, closed periods, atomic rollback, detailed validation, revision conflict and grants. Approval/source engine is covered separately by existing integration suites.');
}catch(error){console.error(error.message,error.where??'');process.exitCode=1;}finally{await db.close();}
