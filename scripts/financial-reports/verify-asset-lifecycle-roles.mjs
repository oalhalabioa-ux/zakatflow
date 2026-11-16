// Real lifecycle prepare/apply and canonical book functions in isolated PostgreSQL/WASM.
// Event command persistence and permissions are fixture adapters, not hosted RLS certification.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
const {PGlite}=await import(process.env.FISCAL_POSTGRES_TEST_MODULE);
const db=new PGlite();
const org='a0000000-0000-4000-8000-000000000001',user='a0000000-0000-4000-8000-000000000002';
const query=async(s,p=[]) => (await db.query(s,p)).rows;
try {
 await db.exec(`create role anon;create role authenticated;create schema private;create schema auth;
 set check_function_bodies=false;
 create type public.transaction_type as enum('OPENING_BALANCE','PURCHASE','SALE','ADJUSTMENT','REVERSAL');
 create type public.lot_status as enum('ACTIVE','CLOSED');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table organizations(id uuid primary key,owner_user_id uuid,base_currency text);
 create function public.has_organization_permission(uuid,text) returns boolean language sql stable as $$select exists(select 1 from public.organizations where id=$1 and owner_user_id=auth.uid())$$;
 create function public.financial_core_can(uuid,text) returns boolean language sql stable as $$select public.has_organization_permission($1,$2)$$;
 create table asset_accounts(id uuid primary key default gen_random_uuid(),organization_id uuid,user_id uuid,entity_id uuid,cost_center_id uuid,name text,ownership_scope text,asset_class_code text,asset_type_code text,metadata jsonb default '{}');
 create table transactions(id uuid primary key default gen_random_uuid(),user_id uuid,asset_account_id uuid,organization_id uuid,entity_id uuid,transaction_type public.transaction_type,transaction_date date,quantity numeric,currency text,gross_value numeric,base_currency text,base_value numeric,metadata jsonb default '{}',created_by uuid,created_at timestamptz default clock_timestamp(),reversal_of_transaction_id uuid);
 create table transaction_allocations(transaction_id uuid,value_base numeric);
 create table lots(id uuid primary key default gen_random_uuid(),asset_account_id uuid,remaining_quantity numeric,remaining_value_base numeric,acquisition_date date,status public.lot_status default 'ACTIVE',metadata jsonb default '{}');
 create table financial_classifications(id uuid primary key default gen_random_uuid(),organization_id uuid,code text,name text,classification_type text,active boolean default true,is_system boolean default false,metadata jsonb default '{}',created_by uuid,unique(organization_id,code));
 create table liquidity_counterparties(id uuid primary key default gen_random_uuid(),organization_id uuid,party_type text);
 create table asset_lifecycle_commands(id uuid primary key default gen_random_uuid(),asset_account_id uuid,organization_id uuid,created_by uuid,request_id uuid,payload_fingerprint text,operation text,operation_date date,quantity numeric,amount numeric,expected_quantity numeric,expected_book_value numeric,book_effect numeric,vat_amount numeric,financial_event_id uuid,applied_at timestamptz,transaction_id uuid,lot_states jsonb);
 create table financial_events(id uuid primary key default gen_random_uuid(),organization_id uuid,source_module text,source_record_id uuid,source_event_key text,created_by uuid,event_date date,due_date date,base_currency text,status text default 'DRAFT',payload jsonb);
 create function private.financial_opening_event_active(uuid,uuid,date) returns boolean language sql stable as $$select exists(select 1 from public.financial_events where organization_id=$1 and id=$2 and status='ACTUAL' and event_date<=$3)$$;
 create function public.create_financial_event_command(jsonb) returns uuid language plpgsql as $$declare eid uuid;begin
 insert into public.financial_events(organization_id,source_module,source_record_id,source_event_key,created_by,event_date,due_date,base_currency,payload)
 values(($1->>'organization_id')::uuid,$1->>'source_module',($1->>'source_record_id')::uuid,$1->>'source_event_key',auth.uid(),($1->>'event_date')::date,($1->>'due_date')::date,$1->>'base_currency',$1) returning id into eid;return eid;end$$;
 create function public.ensure_asset_cash_forecast(uuid) returns void language sql as $$select$$;
 `);
 const original=await readFile('supabase/migrations/20261010124907_asset_lifecycle_approval_commands.sql','utf8');
 await db.exec(original.slice(original.indexOf('create or replace function public.apply_asset_lifecycle_event()'),original.indexOf('create or replace function public.guard_asset_acquisition_edit()')));
 const book=await readFile('supabase/migrations/20261103143424_financial_reporting_source_adapters.sql','utf8');
 await db.exec(book.slice(0,book.indexOf('-- Legacy actual registers')));
 await db.exec(await readFile('supabase/migrations/20261109170336_asset_lifecycle_posting_roles.sql','utf8'));
 await query('insert into organizations values($1,$2,\'SAR\')',[org,user]);
 await query("select set_config('request.jwt.claim.sub',$1,false)",[user]);
 const party=(await query("insert into liquidity_counterparties(organization_id,party_type) values($1,'CUSTOMER') returning id",[org]))[0].id;
 async function asset(gross=1000,quantity=2){
  const id=(await query("insert into asset_accounts(organization_id,user_id,name,ownership_scope,asset_class_code,asset_type_code) values($1,$2,'Machine','ORGANIZATION','PPE','MACHINERY') returning id",[org,user]))[0].id;
  await query("insert into transactions(asset_account_id,organization_id,transaction_type,transaction_date,quantity,base_currency,base_value) values($1,$2,'OPENING_BALANCE','2026-01-01',$3,'SAR',$4)",[id,org,quantity,gross]);
  await query("insert into lots(asset_account_id,remaining_quantity,remaining_value_base,acquisition_date) values($1,$2,$3,'2026-01-01')",[id,quantity,gross]);
  return id;
 }
 async function prepare(id,operation,date,amount=0,quantity=0,vat=0,request=null){
  const payload={operation,date,amount,quantity,vat_amount:vat,...(operation==='SALE'?{counterparty_id:party,due_date:date}:{})};
  const r=(await query('select public.prepare_asset_lifecycle($1,$2,coalesce($3::uuid,gen_random_uuid())) result',[id,JSON.stringify(payload),request]))[0].result;
  const raw=(await query('select payload from financial_events where id=$1',[r.financial_event_id]))[0].payload;
  return {id:r.financial_event_id,raw,command:r};
 }
 const post=async e=>query("update financial_events set status='ACTUAL' where id=$1",[e.id]);
 const roles=e=>Object.fromEntries(e.raw.lines.map(l=>[l.metadata.source_role,Number(l.base_amount)]));
 const investment=await asset();
 await query("update asset_accounts set asset_class_code='INVESTMENT',asset_type_code='EQUITY' where id=$1",[investment]);
 const investmentSale=await prepare(investment,'SALE','2026-03-01',600,1);
 assert.equal(roles(investmentSale).INVESTMENT_SALE_NET_BOOK_VALUE,500);
 assert.equal(roles(investmentSale).INVESTMENT_SALE_GAIN,100);
 assert.equal(roles(investmentSale).SALE_NET_BOOK_VALUE,undefined);
 const unclassified=await asset();
 await query("update asset_accounts set asset_class_code=null where id=$1",[unclassified]);
 const unknownSale=await prepare(unclassified,'SALE','2026-03-01',600,1);
 assert.equal(roles(unknownSale).UNCLASSIFIED_SALE_NET_BOOK_VALUE,500);
 assert.equal(roles(unknownSale).SALE_NET_BOOK_VALUE,undefined);
 const machine=await asset();
 const dep=await prepare(machine,'DEPRECIATION','2026-02-01',100);
 assert.deepEqual(roles(dep),{DEPRECIATION:100});
 assert.equal(Number((await query('select remaining_value_base from lots where asset_account_id=$1',[machine]))[0].remaining_value_base),1000);
 await post(dep);
 const sale=await prepare(machine,'SALE','2026-03-01',400,1,60);
 assert.deepEqual(roles(sale),{SALE_LOSS:50,SALE_NET_BOOK_VALUE:450,OUTPUT_VAT:60,ACCUMULATED_DEPRECIATION_RELEASE:50});
 assert.equal(sale.raw.obligations[0].settleable_base_amount,460);
 await post(sale);
 const disposal=await prepare(machine,'DISPOSAL','2026-04-01',0,1);
 assert.deepEqual(roles(disposal),{DISPOSAL_LOSS:450,ACCUMULATED_DEPRECIATION_RELEASE:50});
 await post(disposal);
 const finalBook=(await query("select private.financial_opening_asset_book($1,$2,'2026-12-31') book",[org,machine]))[0].book;
 assert.deepEqual(finalBook,{known:true,gross:'0.0000',depreciation:'0.0000',issue:null});
 // Reverse the last operation with the actual lot-restoration trigger.
 await query("update financial_events set status='REVERSED' where id=$1",[disposal.id]);
 const restored=(await query("select private.financial_opening_asset_book($1,$2,'2026-12-31') book",[org,machine]))[0].book;
 assert.equal(restored.gross,'500.0000');assert.equal(restored.depreciation,'50.0000');
 assert.equal(Number((await query('select remaining_value_base from lots where asset_account_id=$1',[machine]))[0].remaining_value_base),450);
 const gainSale=await prepare(machine,'SALE','2026-05-01',600,1);
 assert.deepEqual(roles(gainSale),{SALE_GAIN:150,SALE_NET_BOOK_VALUE:450,ACCUMULATED_DEPRECIATION_RELEASE:50});
 // Source role amounts yield both net proceeds and removal of GROSS cost.
 const pairs={DEPRECIATION:['6200','1590'],SALE_LOSS:['6100','1100'],SALE_GAIN:['1100','4100'],SALE_NET_BOOK_VALUE:['1100','1500'],OUTPUT_VAT:['1100','2300'],ACCUMULATED_DEPRECIATION_RELEASE:['1590','1500'],DISPOSAL_LOSS:['6100','1500']};
 const balances={};for(const e of [dep,sale,disposal])for(const l of e.raw.lines){const [d,c]=pairs[l.metadata.source_role];balances[d]=(balances[d]??0)+Number(l.base_amount);balances[c]=(balances[c]??0)-Number(l.base_amount);}
 assert.equal(balances['1500'],-1000);assert.equal(balances['1590'],0);assert.equal(balances['1100'],460);assert.equal(balances['6100'],500);assert.equal(balances['6200'],100);
 assert.equal(Object.values(balances).reduce((a,b)=>a+b,0),0);
 const fully=await asset(100,1);const fullDep=await prepare(fully,'DEPRECIATION','2026-02-01',100);await post(fullDep);
 const zeroDisposal=await prepare(fully,'DISPOSAL','2026-03-01',0,1);assert.deepEqual(roles(zeroDisposal),{ACCUMULATED_DEPRECIATION_RELEASE:100});await post(zeroDisposal);
 const stale=await prepare(machine,'DISPOSAL','2026-06-01',0,1);
 const nextDep=await prepare(machine,'DEPRECIATION','2026-05-02',50);await post(nextDep);
 await assert.rejects(post(stale),/ASSET_OPERATION_BALANCE_CHANGED_RECREATE/);
 await assert.rejects(prepare(machine,'DISPOSAL','2026-02-15',0,1),/ASSET_BOOK_RECONCILIATION_REQUIRED/);
 // Authenticated callers can use only the narrow public boundary; no private-schema grant.
 await db.exec('set role authenticated');
 const authorized=(await query("select public.asset_lifecycle_posting_context($1,'2026-12-31',400) book",[machine]))[0].book;
 assert.equal(authorized.gross,'500.0000');
 await assert.rejects(query("select private.asset_lifecycle_posting_context($1,'2026-12-31',400)",[machine]),/permission denied/);
 await db.exec('reset role');
 // A foreign user cannot read the book or seed classifications through the helper.
 await query("select set_config('request.jwt.claim.sub',gen_random_uuid()::text,false)");
 await assert.rejects(query("select public.asset_lifecycle_posting_context($1,'2026-12-31',400)",[machine]),/ASSET_ORGANIZATION_ACCESS_DENIED/);
 assert.equal((await query("select has_function_privilege('anon','private.asset_lifecycle_posting_context(uuid,date,numeric)','execute') allowed"))[0].allowed,false);
 const catalog=(await readFile('tests/migration-history/catalog.sql','utf8')).trim().replace(/;$/,'');
 const upserts=(await query(catalog)).filter(r=>r.object_key.startsWith('public.prepare_asset_lifecycle(')||r.object_key.startsWith('private.asset_lifecycle_posting_context(')||r.object_key.startsWith('public.asset_lifecycle_posting_context(')||r.object_key.startsWith('public.apply_asset_lifecycle_event('));
 assert.equal(upserts.length,4);
 const delta={description:'Explicit lifecycle roles and canonical gross/depreciation reconciliation for new commands.',removals:[],upserts};
 const path='tests/migration-history/asset-lifecycle-posting-schema-delta.json';
 if(process.argv.includes('--write-delta'))await writeFile(path,JSON.stringify(delta,null,2)+'\n');else assert.deepEqual(delta,JSON.parse(await readFile(path,'utf8')));
 console.log('PASS actual lifecycle prepare/apply: depreciation, partial sale loss and VAT, disposal, gain, fully depreciated disposal, reversal, stale/retroactive rejection and scoped book access');
}catch(e){console.error(e.message,e.where??'',e.position??'');process.exitCode=1;}finally{await db.close();}
