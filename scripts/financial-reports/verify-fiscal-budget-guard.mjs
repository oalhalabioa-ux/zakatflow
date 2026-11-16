// Optional local PostgreSQL/WASM check. Never connects to any hosted database.
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const {PGlite}=await import(process.env.FISCAL_POSTGRES_TEST_MODULE);
const db=new PGlite();
try{
 await db.exec(`create role anon;create role authenticated;create schema auth;create schema private;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table public.organizations(id uuid primary key,owner_user_id uuid,name text);
 create table public.financial_opening_workspaces(organization_id uuid,fiscal_start date);
 create table public.financial_reporting_policies(organization_id uuid,fiscal_start date);
 create function private.financial_opening_can(org uuid,scope text) returns boolean language sql stable as $$select exists(select 1 from public.organizations where id=org and owner_user_id=auth.uid())$$;
 create function public.financial_reporting_chart() returns jsonb language sql immutable as $$select '[{"code":"3300","kind":"EQUITY"}]'::jsonb$$;
 create table public.budget_plans(id uuid primary key,user_id uuid,name text,fiscal_year integer,currency text,scenario text,status text,organization_name text,cost_center text);
 create table public.financial_budget_plan_ownership(plan_id uuid primary key,organization_id uuid not null,fiscal_start date not null,entity_id uuid,cost_center_id uuid,adopted_by uuid);
 `);
 const existing=await readFile('supabase/migrations/20261104093720_general_fiscal_opening_engine.sql','utf8');
 await db.exec(existing.slice(0,existing.indexOf('alter table public.financial_opening_source_assignments add column')));
 const newMigration=await readFile('supabase/migrations/20261104165205_fiscal_calendar_budget_guards.sql','utf8');
 await db.exec(newMigration);
 const result=await db.exec(await readFile('tests/qa-financial-fiscal-budget-calendar.sql','utf8'));
 assert.match(JSON.stringify(result),/PASS independent January\/July/);
 const catalog=(await readFile('tests/migration-history/catalog.sql','utf8')).trim().replace(/;$/,'');
 const delta=await db.query(`select * from (${catalog}) c where (category='function' and object_key like 'private.financial_guard_budget_calendar(%') or (category='trigger' and object_key in ('public.financial_fiscal_calendars.fiscal_calendar_budget_guard','public.financial_budget_plan_ownership.budget_fiscal_calendar_guard')) order by category,object_key`);
 assert.equal(delta.rows.length,3);
 const path='tests/migration-history/fiscal-budget-calendar-schema-delta.json';
 if(process.argv.includes('--write-delta'))await writeFile(path,JSON.stringify({description:'Budget calendar alignment guards only; no row transformations or new engine.',removals:[],upserts:delta.rows},null,2)+'\n');
 else assert.deepEqual(JSON.parse(await readFile(path,'utf8')).upserts,delta.rows);
 console.log('PASS real PostgreSQL guard SQL: January/July alignment, protected approved bindings, unchanged budget records, initial legacy calendar review; 3 catalog additions.');
}finally{await db.close()}
