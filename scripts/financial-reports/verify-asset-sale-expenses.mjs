// Validate the actual migration against disposable PostgreSQL/WASM.
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
const {PGlite} = await import(process.env.FISCAL_POSTGRES_TEST_MODULE);
const db = new PGlite();
const sql = (s, p = []) => db.query(s, p).then(result => result.rows);
const uid = 'a0000000-0000-4000-8000-000000000001';
const other = 'a0000000-0000-4000-8000-000000000002';
const org = 'a0000000-0000-4000-8000-000000000003';
const ids = Array.from({length: 16}, (_, i) => `b0000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
const [sale, corrected, bank, payment, receipt, secondSale, secondReceipt, companySale, companyExpense, command, saleEvent, opex, tax] = ids;
try {
 await db.exec(`
  create role anon; create role authenticated; create schema auth; create schema private;
  create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  grant usage on schema auth, private to authenticated;
  create type transaction_type as enum ('SALE','ADD','WITHDRAWAL','REVERSAL');
  create table asset_accounts(id uuid primary key,user_id uuid,organization_id uuid,asset_type text);
  create table transactions(id uuid primary key,user_id uuid,organization_id uuid,entity_id uuid,
    asset_account_id uuid,transaction_type transaction_type,base_currency text,base_value numeric,
    transfer_id uuid,reversal_of_transaction_id uuid,metadata jsonb not null default '{}');
  create table financial_events(id uuid primary key,organization_id uuid,entity_id uuid,base_currency text,
    event_type text,status text,source_module text,source_record_id uuid);
  create table financial_classifications(id uuid primary key,organization_id uuid,classification_type text);
  create table financial_event_lines(event_id uuid,organization_id uuid,classification_id uuid,base_amount numeric,vat_amount numeric,metadata jsonb);
  create table financial_event_links(event_id uuid,related_event_id uuid,link_type text);
  create table financial_vat_source_bindings(event_id uuid,original_event_id uuid);
  create table asset_lifecycle_commands(id uuid,transaction_id uuid,organization_id uuid,asset_account_id uuid,
    operation text,applied_at timestamptz,financial_event_id uuid);
  create table voucher_numbers(source_table text,source_id uuid,organization_id uuid,owner_id uuid,document_number text);
  create table audit_logs(user_id uuid,entity_type text,entity_id uuid,action text,new_data jsonb);
  create function has_organization_permission(uuid,text) returns boolean language sql as $$ select auth.uid()='${uid}'::uuid and $1='${org}'::uuid $$;
  create function financial_core_can(uuid,text) returns boolean language sql as $$ select auth.uid()='${uid}'::uuid and $1='${org}'::uuid $$;
 `);
 await db.exec(await readFile('supabase/migrations/20261124140000_asset_sale_expense_links.sql', 'utf8'));
 const catalog=(await readFile('tests/migration-history/catalog.sql','utf8')).trim().replace(/;$/,'');
 // PostgreSQL 18 stores NOT NULL as a named constraint; the hosted catalog is PostgreSQL 17.
 const objects=await sql(`select * from (${catalog}) catalog where object_key like '%asset_sale_expense%'
   and not (category='constraint' and right(object_key,9)='_not_null')`);
 const delta={description:'Reporting-only links from asset sales to existing direct expense vouchers',upserts:objects,removals:[]};
 const deltaPath='tests/migration-history/asset-sale-expense-links-schema-delta.json';
 if (process.argv.includes('--write-catalog')) await writeFile(deltaPath,JSON.stringify(delta,null,2)+'\n');
 else assert.deepEqual(delta,JSON.parse(await readFile(deltaPath,'utf8')));

 await sql("insert into asset_accounts values ($1,$2,null,'BANK')",[bank,uid]);
 const reference=(id, asset=bank)=>JSON.stringify({proceeds_account_id:asset, sale_transaction_id:id,source:'sale_proceeds'});
 async function transaction(id, type, base, {organization=null, replacement=null, metadata={}}={}) {
  await sql('insert into transactions values ($1,$2,$3,null,$4,$5,$6,$7,$8,null,$9)',[id,uid,organization,bank,type,'SAR',base,replacement,JSON.stringify(metadata)]);
 }
 for (const [id,r] of [[sale,receipt],[secondSale,secondReceipt]]) {
  await transaction(id,'SALE',6000,{replacement:id,metadata:{proceeds_account_id:bank}});
  await transaction(r,'ADD',6000,{replacement:id,metadata:JSON.parse(reference(id))});
 }
 await transaction(payment,'WITHDRAWAL',120);
 await sql("insert into voucher_numbers values ('transactions',$1,null,$2,'PV-0008-26')",[payment,uid]);
 const actor=async id=>{await sql("select set_config('request.jwt.claim.sub',$1,false)",[id]);};
 const link=(id,src,remove=false)=>sql("select public.link_asset_sale_expense($1,$2,'Broker commission on voucher',$3)",[id,src,remove]);
 const read=id=>sql('select source_id,voucher,state,amount from public.asset_sale_expenses(array[$1]::uuid[])',[id]);
 assert.equal((await sql("select has_function_privilege('anon','public.asset_sale_expenses(uuid[])','EXECUTE') permission"))[0].permission,false);
 assert.equal((await sql("select prosecdef from pg_proc where oid='public.asset_sale_expenses(uuid[])'::regprocedure"))[0].prosecdef,false);
 await actor(uid);
 await db.exec('set role authenticated');
 await assert.rejects(sql('select * from private.asset_sale_expense_links'), /permission denied/);
 await link(sale,'PV-0008-26');
 await link(sale,payment);
 assert.deepEqual(await read(sale),[{source_id:payment,voucher:'PV-0008-26',state:'RECORDED',amount:'120'}]);
 await assert.rejects(link(secondSale,payment),/SALE_EXPENSE_ALREADY_LINKED/);
 await actor(other);
 assert.deepEqual(await read(sale),[]);
 await assert.rejects(link(sale,payment),/SALE_EXPENSE_ACCESS_DENIED/);
 await db.exec('reset role');
 assert.equal((await sql('select count(*)::int n from audit_logs'))[0].n,1);
 await transaction(corrected,'SALE',5400,{metadata:{corrects_sale_id:sale}});
 await sql("update transactions set metadata=metadata||jsonb_build_object('sale_correction_replacement_id',$2::text) where id=$1",[sale,corrected]);
 await actor(uid);
 await db.exec('set role authenticated');
 assert.deepEqual(await read(corrected),await read(sale));
 await db.exec('reset role');
 await sql("update transactions set metadata=metadata||'{\"lifecycle_reversed\":true}' where id=$1",[payment]);
 assert.equal((await read(corrected))[0].state,'REVERSED');
 await link(corrected,payment,true);
 assert.deepEqual(await read(corrected),[]);
 assert.equal((await sql('select count(*)::int n from audit_logs'))[0].n,2);

 await transaction(companySale,'SALE',123200,{organization:org});
 await sql("insert into financial_events values ($1,$3,null,'SAR','ADJUSTMENT','ACTUAL','ASSET_LIFECYCLE',$4),($2,$3,null,'SAR','EXPENSE','ACTUAL','VAT_INTEGRATION',null)",[saleEvent,companyExpense,org,command]);
 await sql("insert into asset_lifecycle_commands values ($1,$2,$3,$4,'SALE',now(),$5)",[command,companySale,org,bank,saleEvent]);
 await sql("insert into financial_classifications values ($1,$3,'OPEX'),($2,$3,'TAX')",[opex,tax,org]);
 await sql(`insert into financial_event_lines values($1,$2,$3,300,0,'{}'),
   ($1,$2,$4,45,0,'{"source_role":"INPUT_VAT","recoverable_percent":100}')`,[companyExpense,org,opex,tax]);
 await db.exec('set role authenticated');
 await link(companySale,companyExpense);
 assert.equal((await read(companySale))[0].amount,'300.0000');
 await actor(other);
 assert.deepEqual(await read(companySale),[]);
 await assert.rejects(link(companySale,companyExpense),/SALE_EXPENSE_ACCESS_DENIED/);
 await db.exec('reset role');
 await actor(uid);
 await sql("update financial_event_lines set metadata=metadata||'{\"recoverable_percent\":50}' where classification_id=$1",[tax]);
 assert.equal((await read(companySale))[0].amount,'322.5000');
 await sql("update financial_events set status='REVERSED' where id=$1",[companyExpense]);
 assert.equal((await read(companySale))[0].state,'REVERSED');
 console.log('PASS private ACLs, one link per expense, authenticated scope, correction lineage, reversal, audited unlink, and institutional OPEX / VAT.');
} finally { await db.close(); }
