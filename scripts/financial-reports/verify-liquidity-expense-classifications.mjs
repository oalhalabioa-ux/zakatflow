// Runs the migration against disposable PostgreSQL and generates its catalog delta.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
const {PGlite}=await import(process.env.FISCAL_POSTGRES_TEST_MODULE);
const db=new PGlite();
const id=n=>'80000000-0000-4000-8000-'+String(n).padStart(12,'0');
const migration='20261109123942_liquidity_expense_classification_link';
const deltaPath='tests/migration-history/liquidity-expense-classification-schema-delta.json';
try{
 await db.exec(`create role anon; create role authenticated; create schema private;
  create table financial_classifications(id uuid primary key, organization_id uuid not null, classification_type text not null, active boolean not null);
  create table liquidity_flow_categories(id uuid primary key, organization_id uuid not null, financial_classification_type text);
  grant select on financial_classifications,liquidity_flow_categories to authenticated;
  grant insert(id,organization_id,financial_classification_type) on liquidity_flow_categories to authenticated;
  insert into liquidity_flow_categories values('${id(1)}','${id(2)}','OPEX');
  insert into financial_classifications values
   ('${id(3)}','${id(2)}','OPEX',true),('${id(4)}','${id(2)}','OPEX',true),
   ('${id(5)}','${id(6)}','OPEX',true),('${id(7)}','${id(2)}','OPEX',false),
   ('${id(8)}','${id(2)}','REVENUE',true);
  set check_function_bodies=off;`);
 const definitions=[
  ['20261006143330_vat_financial_core_adapter_prod_v1','prepare_vat_financial_event'],
  ['20261007150032_amend_purchase_invoice_restore_cash_forecast_v2','amend_unsettled_purchase_invoice'],
  ['20261010124907_asset_lifecycle_approval_commands','prepare_asset_lifecycle'],
 ];
 for(const [file,name] of definitions){
  const original=await readFile('supabase/migrations/'+file+'.sql','utf8');
  const start=original.indexOf('create or replace function public.'+name+'(');
  assert.ok(start>=0);
  const end=original.indexOf('$$;',original.indexOf('$$',start)+2);
  assert.ok(end>start);
  await db.exec(original.slice(start,end+3));
 }
 await db.exec(await readFile('supabase/migrations/'+migration+'.sql','utf8'));
 await db.exec('set role authenticated');
 const add=(category,classification,type='OPEX')=>db.query(
  'insert into liquidity_flow_categories values($1,$2,$3,$4)',[id(category),id(2),type,id(classification)]);
 await add(9,3);await add(10,4);
 for(const [classification,type] of [[5,'OPEX'],[7,'OPEX'],[8,'OPEX'],[3,'REVENUE']])
  await assert.rejects(add(11,classification,type),/LIQUIDITY_EXPENSE_CLASSIFICATION_INVALID/);
 const rows=(await db.query('select expense_classification_id from liquidity_flow_categories order by id')).rows;
 assert.deepEqual(rows.map(row=>row.expense_classification_id),[null,id(3),id(4)]);
 await db.exec('reset role');
 const catalog=(await readFile('tests/migration-history/catalog.sql','utf8')).trim().replace(/;$/,'');
 const fingerprints=(await db.query('select * from ('+catalog+`) c where
  object_key like '%liquidity_flow_categories.expense_classification_id'
  or object_key like '%liquidity_flow_categories.liquidity_flow_categories_expense_classification_id_fkey'
  or object_key like '%validate_liquidity_expense_classification%'
  or object_key like 'public.prepare_vat_financial_event(%'
  or object_key like 'public.amend_unsettled_purchase_invoice(%'
  or object_key like 'public.prepare_asset_lifecycle(%'
  order by category,object_key`)).rows;
 assert.equal(fingerprints.length,7);
 const delta={description:'Optional operating expense classification on liquidity categories, with tenant/type guard and generic VAT/asset fallback.',removals:[],upserts:fingerprints};
 if(process.argv.includes('--write-delta'))await writeFile(deltaPath,JSON.stringify(delta,null,2)+'\n');
 else assert.deepEqual(JSON.parse(await readFile(deltaPath,'utf8')),delta);
 console.log('PASS: legacy category unchanged; two distinct mappings; reject foreign tenant, inactive, wrong type; canonical schema fingerprints');
}finally{await db.close();}
