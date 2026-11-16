// Actual debt source command, with isolated permission/persistence adapters.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
const {PGlite}=await import(process.env.FISCAL_POSTGRES_TEST_MODULE);
const db=new PGlite();const id=n=>'c0000000-0000-4000-8000-'+String(n).padStart(12,'0');
const org=id(1),user=id(2),bank=id(3),party=id(4),other=id(5);
const query=async(s,p=[]) => (await db.query(s,p)).rows;
try{
 await db.exec(`create schema private;create schema auth;create schema extensions;create role anon;create role authenticated;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function extensions.digest(text,text) returns bytea language sql immutable as $$select decode(md5($1),'hex')$$;
 create table organizations(id uuid primary key,owner_id uuid,base_currency text);
 create function financial_core_can(uuid,text) returns boolean language sql stable as $$select exists(select 1 from organizations where id=$1 and owner_id=auth.uid())$$;
 create function effective_organization_permission(uuid,text,numeric,text) returns boolean language sql stable as $$select financial_core_can($1,$2)$$;
 create table liquidity_accounts(id uuid,organization_id uuid,active boolean,currency text,entity_id uuid);
 create table liquidity_counterparties(id uuid,organization_id uuid,active boolean);
 create table organization_entities(id uuid,organization_id uuid,active boolean);
 create table financial_classifications(id uuid primary key default gen_random_uuid(),organization_id uuid,code text,name text,classification_type text,is_system boolean,created_by uuid,active boolean default true,metadata jsonb default '{}',unique(organization_id,code));
 create table debt_contracts(id uuid primary key default gen_random_uuid(),organization_id uuid,request_id uuid,kind text,mode text,side text,counterparty_id uuid,entity_id uuid,account_id uuid,category text,description text,reference text,event_date date,currency text,exchange_rate numeric,principal numeric,schedule jsonb,payload_fingerprint text,created_by uuid,financial_event_id uuid);
 create table command_events(id uuid primary key default gen_random_uuid(),payload jsonb,status text default 'DRAFT');
 create function create_financial_event_command(jsonb) returns uuid language plpgsql as $$declare eid uuid;begin insert into command_events(payload) values($1) returning id into eid;return eid;end$$;
 create function transition_financial_event(uuid,text,text) returns void language sql as $$update command_events set status=$2 where id=$1$$;
 `);
 const fixture=JSON.parse(await readFile('tests/migration-history/account-inheritance-source-functions.json','utf8')).find(f=>f.name==='create_debt_contract');
 await db.exec(fixture.definition.replace(/from\s+public\.financial_classifications\s+where/gi,"from (select * from public.financial_classifications where not (metadata ? 'accountInheritance') and not (metadata ? 'automaticExpenseAccount')) financial_classifications where"));
 await db.exec(await readFile('supabase/migrations/20261109181035_debt_principal_source_roles.sql','utf8'));
 await query("insert into organizations values($1,$2,'SAR')",[org,user]);await query("select set_config('request.jwt.claim.sub',$1,false)",[user]);
 await query("insert into liquidity_accounts values($1,$2,true,'SAR',null)",[bank,org]);await query('insert into liquidity_counterparties values($1,$2,true)',[party,org]);
 await query("insert into financial_classifications(id,organization_id,code,classification_type) values($1,$3,'UNRELATED_ASSET','ASSET'),($2,$3,'UNRELATED_LIABILITY','LIABILITY')",[id(10),id(11),org]);
 const payload=(side='PAYABLE',mode='NEW',kind='LOAN',category=side==='PAYABLE'?'O_AP_LOAN':'O_AR_LOAN')=>({organization_id:org,request_id:crypto.randomUUID(),side,mode,kind,category,counterparty_id:party,account_id:bank,entity_id:null,principal:1000,currency:'SAR',exchange_rate:1,date:'2026-01-01',description:'Test principal source',reference:'Debt source',schedule:[{due_date:'2026-06-01',amount:400},{due_date:'2026-12-01',amount:600}]});
 const create=async p=>(await query('select private.create_debt_contract($1) result',[JSON.stringify(p)]))[0].result;
 for(const [side,mode,kind,category,role,direction] of [
  ['PAYABLE','NEW','LOAN','O_AP_LOAN','DEBT_FUNDED_O_AP_LOAN','INFLOW'],
  ['RECEIVABLE','NEW','LOAN','O_AR_LOAN','DEBT_FUNDED_O_AR_LOAN','OUTFLOW'],
  ['RECEIVABLE','NEW','EMPLOYEE_ADVANCE','O_AR_EMPLOYEE','DEBT_FUNDED_O_AR_EMPLOYEE','OUTFLOW'],
  ['PAYABLE','OPENING','OPENING','O_AP_SUPPLIER','DEBT_OPENING_O_AP_SUPPLIER','NON_CASH'],
 ]){
  const p=payload(side,mode,kind,category),created=await create(p),event=(await query('select * from command_events where id=$1',[created.eventId]))[0];
  const line=event.payload.lines[0],classification=(await query('select code from financial_classifications where id=$1',[line.classification_id]))[0];
  assert.equal(classification.code,side==='PAYABLE'?'DEBT_PRINCIPAL_LIABILITY':'DEBT_PRINCIPAL_ASSET');
  assert.equal(line.metadata.source_role,role);assert.equal(line.cash_direction,direction);assert.equal(event.status,'COMMITTED');
  assert.equal(event.payload.obligations.reduce((n,o)=>n+o.settleable_base_amount,0),1000);
  assert.equal((await create(p)).eventId,created.eventId);
  await assert.rejects(create({...p,description:'Different request body'}),/DEBT_CONTRACT_REQUEST_CONFLICT/);
 }
 await assert.rejects(create({...payload(),organization_id:other}),/DEBT_CONTRACT_ACCESS_DENIED/);
 await query("update financial_classifications set active=false where organization_id=$1 and code='DEBT_PRINCIPAL_LIABILITY'",[org]);
 await assert.rejects(create(payload()),/DEBT_CLASSIFICATION_REQUIRED/);
 const catalog=(await readFile('tests/migration-history/catalog.sql','utf8')).trim().replace(/;$/,'');
 const delta={description:'Exact debt principal classification and mode/category source roles for new commands.',removals:[],upserts:(await query(catalog)).filter(r=>r.object_key==='private.create_debt_contract(p jsonb)')};assert.equal(delta.upserts.length,1);
 const path='tests/migration-history/debt-principal-role-schema-delta.json';
 if(process.argv.includes('--write-delta'))await writeFile(path,JSON.stringify(delta,null,2)+'\n');else assert.deepEqual(JSON.parse(await readFile(path,'utf8')),delta);
 // Exercise the actual refund/reschedule prepare command, not a payload replica.
 await db.exec(`create table financial_events(id uuid primary key,organization_id uuid,status text,source_module text,event_date date,base_currency text,counterparty_id uuid,entity_id uuid);
 create table financial_event_obligations(id uuid primary key,organization_id uuid,event_id uuid,adjusts_obligation_id uuid,obligation_type text,exchange_rate numeric,currency text,base_currency text);
 create table financial_event_obligation_balances(obligation_id uuid,outstanding_base_amount numeric);
 create table liquidity_settlements(id uuid,organization_id uuid,financial_event_id uuid,status text,amount numeric,exchange_rate numeric,currency text,base_currency text,direction text);
 create table debt_operation_requests(id uuid primary key default gen_random_uuid(),organization_id uuid,request_id uuid,kind text,target_id uuid,payload jsonb,fingerprint text,financial_event_id uuid,created_by uuid);
 `);
 const opFixture=JSON.parse(await readFile('tests/migration-history/account-inheritance-source-functions.json','utf8')).find(f=>f.name==='prepare_debt_operation');
 await db.exec(opFixture.definition.replace(/from\s+public\.financial_classifications\s+where/gi,"from (select * from public.financial_classifications where not (metadata ? 'accountInheritance') and not (metadata ? 'automaticExpenseAccount')) financial_classifications where"));
 const opSql=await readFile('supabase/migrations/20261109183825_debt_refund_and_schedule_posting.sql','utf8');
 await db.exec(opSql.split('-- BEGIN DEBT OPERATION SOURCE')[1].split('-- END DEBT OPERATION SOURCE')[0]);
 const prepare=async p=>(await query('select private.prepare_debt_operation($1) result',[JSON.stringify(p)]))[0].result;
 for(const [i,side,direction,code] of [[50,'SUPPLIER_ADVANCE','INFLOW','DEBT_RECEIVABLE_CLEARING'],[60,'CUSTOMER_ADVANCE','OUTFLOW','DEBT_PAYABLE_CLEARING']]){
  await query("insert into financial_events values($1,$2,'ACTUAL','ADVANCE_WORKSPACE','2026-01-01','SAR',$3,null)",[id(i),org,party]);
  await query("insert into financial_event_obligations values($1,$2,$3,null,$4,1,'SAR','SAR')",[id(i+1),org,id(i),side]);
  await query('insert into financial_event_obligation_balances values($1,100)',[id(i+1)]);
  const p={organization_id:org,request_id:crypto.randomUUID(),kind:'REFUND',target_id:id(i+1),date:'2026-02-01',reason:'Return unused advance',amount:25};
  const result=await prepare(p),event=(await query('select * from command_events where id=$1',[result.eventId]))[0];
  assert.equal(event.payload.lines[0].metadata.source_role,'DEBT_REFUND_'+side);assert.equal(event.payload.lines[0].cash_direction,direction);
  assert.equal((await query('select code from financial_classifications where id=$1',[event.payload.lines[0].classification_id]))[0].code,code);
  assert.equal(event.payload.obligations[0].adjusts_obligation_id,id(i+1));assert.equal(event.payload.obligations[0].settleable_base_amount,25);
  assert.equal((await prepare(p)).eventId,result.eventId);
  await assert.rejects(prepare({...p,request_id:crypto.randomUUID(),amount:101}),/ADVANCE_EXCEEDS_BALANCE/);
  await assert.rejects(prepare({...p,request_id:crypto.randomUUID(),organization_id:other}),/DEBT_OPERATION_ACCESS_DENIED/);
 }
 const contract=(await query("select * from debt_contracts where kind='LOAN' and side='RECEIVABLE' limit 1"))[0];
 await query("insert into financial_events values($1,$2,'ACTUAL','DEBT_CONTRACTS','2026-01-01','SAR',$3,null)",[contract.financial_event_id,org,party]);
 const schedule=await prepare({organization_id:org,request_id:crypto.randomUUID(),kind:'RESCHEDULE',target_id:contract.id,date:'2026-02-01',reason:'Change payment due date',dates:[{obligation_id:id(70),due_date:'2026-09-01'}]});
 const scheduleEvent=(await query('select payload from command_events where id=$1',[schedule.eventId]))[0].payload;
 assert.equal(scheduleEvent.lines[0].metadata.source_role,'DEBT_RESCHEDULE');assert.equal(scheduleEvent.lines[0].cash_direction,'NON_CASH');assert.deepEqual(scheduleEvent.obligations,[]);
 const sourceDelta={description:'Exact debt operation clearing classifications and explicit refund/reschedule source roles.',removals:[],upserts:(await query(catalog)).filter(r=>r.object_key==='private.prepare_debt_operation(p jsonb)')};assert.equal(sourceDelta.upserts.length,1);
 const sourcePath='tests/migration-history/debt-operations-source-schema-delta.json';
 if(process.argv.includes('--write-delta'))await writeFile(sourcePath,JSON.stringify(sourceDelta,null,2)+'\n');else assert.deepEqual(JSON.parse(await readFile(sourcePath,'utf8')),sourceDelta);
 console.log('PASS: actual supplier/customer refund preparation selects exact clearing identity and original adjustment obligation, rejects over-refund/foreign organization; reschedule emits explicit nonposting role');
 console.log('PASS: real debt creation selects exact principal classes, distinguishes funded loans/employee advances/opening, preserves installments and replay, rejects foreign organization/inactive classification');
}catch(e){console.error(e.message,e.where??'');process.exitCode=1;}finally{await db.close();}
