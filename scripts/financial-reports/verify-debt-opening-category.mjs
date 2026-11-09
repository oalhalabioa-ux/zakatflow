// Real category function and installed-function patch replay. This is not full-schema acceptance.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
const {PGlite}=await import(process.env.FISCAL_POSTGRES_TEST_MODULE);
const db=new PGlite(),org='d0000000-0000-4000-8000-000000000001',event='d0000000-0000-4000-8000-000000000002',other='d0000000-0000-4000-8000-000000000003';
const query=async(s,p=[])=>(await db.query(s,p)).rows;
const definition=(text,name)=>{const start=text.search(new RegExp('create (?:or replace )?function '+name.replaceAll('.','\\.')+'\\('));assert.ok(start>=0,name);return text.slice(start,text.indexOf('end $$;',start)+7);};
try{
 await db.exec(`create schema private;create role anon;create role authenticated;set check_function_bodies=false;
 create table financial_event_lines(organization_id uuid,event_id uuid,line_number integer,metadata jsonb);
 create table financial_year_closures(id uuid,organization_id uuid,next_start date,status text,next_source jsonb,fiscal_end date);`);
 const sources=await readFile('supabase/migrations/20261104060000_reporting_first_activity.sql','utf8');
 const general=await readFile('supabase/migrations/20261104093720_general_fiscal_opening_engine.sql','utf8');
 for(const [text,name] of [[sources,'private.financial_opening_sources'],[general,'private.financial_period_opening_sources'],[general,'public.financial_opening_candidates']])await db.exec(definition(text,name));
 // Apply earlier installed patches, preserving their exact catalog definitions.
 const sourcePatch=general.slice(general.indexOf('do $$',general.indexOf('-- A bank declaration')),general.indexOf('-- Replace only calls'));
 await db.exec(sourcePatch);
 const cash=await readFile('supabase/migrations/20261104222828_unified_cash_account_openings.sql','utf8');
 const cashStart=cash.indexOf('do $$',cash.indexOf('revoke all on function private.financial_cash_opening_suggestions'));
 const cashPatch=cash.slice(cashStart,cash.indexOf(" definition:=pg_get_functiondef('public.financial_opening_workspace",cashStart))+'end $$;';
 await db.exec(cashPatch);
 const before=(await query("select pg_get_functiondef('private.financial_period_opening_sources(uuid,date)'::regprocedure) d"))[0].d;
 await db.exec(await readFile('supabase/migrations/20261109185816_debt_opening_category_routing.sql','utf8'));
 await query("insert into financial_event_lines values($1,$2,1,'{}')",[org,event]);
 const account=async(side,scope=org)=>(await query('select private.financial_debt_source_account($1,$2,$3) account',[scope,event,side]))[0].account;
 assert.equal(await account('PAYABLE'),'2200');assert.equal(await account('RECEIVABLE'),'1200');
 for(const prefix of ['DEBT_OPENING_','DEBT_FUNDED_'])for(const [side,categories,expected] of [
  ['RECEIVABLE',['O_AR_LOAN'],'1200'],['PAYABLE',['O_AP_LOAN'],'2200'],
  ['RECEIVABLE',['O_AR_CUSTOMER','O_AR_EMPLOYEE','O_AR_RELATED','O_AR_ACCRUED','O_AR_OTHER'],'1100'],
  ['PAYABLE',['O_AP_SUPPLIER','O_AP_ACCRUAL','O_AP_EMPLOYEE','O_AP_RELATED','O_AP_OTHER'],'2100']])for(const category of categories){
   await query('update financial_event_lines set metadata=$1',[JSON.stringify({source_role:prefix+category})]);
   assert.equal(await account(side),expected,prefix+category);
   await assert.rejects(account(side==='PAYABLE'?'RECEIVABLE':'PAYABLE'),/FISCAL_DEBT_CATEGORY_INVALID/);
  }
 // Same event identity in another scope must not use this organization's source role.
 assert.equal(await account('PAYABLE',other),'2200');
 const after=(await query("select pg_get_functiondef('private.financial_period_opening_sources(uuid,date)'::regprocedure) d"))[0].d;
 assert.equal(after,before.replace("case when ob.obligation_type='PAYABLE' then '2200' else '1200' end",'private.financial_debt_source_account(p_org,ob.event_id,ob.obligation_type)'),'Explicit assignments and closed-year snapshot branches remain intact');
 const catalog=(await readFile('tests/migration-history/catalog.sql','utf8')).trim().replace(/;$/,'');
 const delta={description:'Category routing for new tagged debt openings; historical fallback, assignments and closed snapshots preserved.',removals:[],upserts:(await query(catalog)).filter(r=>/^(private\.financial_(debt_source_account|opening_sources|period_opening_sources)|public\.financial_opening_candidates)\(/.test(r.object_key))};assert.equal(delta.upserts.length,4);
 const path='tests/migration-history/debt-opening-category-schema-delta.json';
 if(process.argv.includes('--write-delta'))await writeFile(path,JSON.stringify(delta,null,2)+'\n');else assert.deepEqual(JSON.parse(await readFile(path,'utf8')),delta);
 console.log('PASS: 24 funded/opening category routes, side rejection, scope isolation, historical fallback and exact preservation of assignment/closed-year branches; catalog patch replay');
}catch(e){console.error(e.message,e.where??'');process.exitCode=1;}finally{await db.close();}
