// Isolated PostgreSQL/WASM source contract; permission and persistence adapters are fixtures.
const {PGlite}=await import(process.env.FISCAL_POSTGRES_TEST_MODULE);
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const db=new PGlite();
const root='./';
const cols=JSON.parse(await readFile('tests/migration-history/native-reversal-row-types.json','utf8'));
const defs=JSON.parse(await readFile('tests/migration-history/native-reversal-source-functions.json','utf8'));
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
try {
await db.exec('create schema private; create schema auth; create role anon; create role authenticated; set check_function_bodies=off;');
for(const name of new Set(cols.map(x=>x.table_name)))await db.exec(`create table public.${name}(${cols.filter(x=>x.table_name===name).map(x=>x.column_name+' '+x.data_type).join(',')})`);
await db.exec(`create table financial_event_links(organization_id uuid,event_id uuid,link_type text,related_event_id uuid);
create table financial_classifications(id uuid default gen_random_uuid(),organization_id uuid,code text,name text,classification_type text,is_system boolean,created_by uuid,active boolean default true,metadata jsonb default '{}',unique(organization_id,code));
create table private.financial_event_posting_resolutions(organization_id uuid,event_id text,lines jsonb);
create function auth.uid() returns uuid language sql as $$select '${id(9)}'::uuid$$;
create function financial_core_can(uuid,text) returns boolean language sql as $$select true$$;
create function effective_organization_permission(uuid,text,numeric,text) returns boolean language sql as $$select $3<=150$$;
create function financial_event_has_valid_approval(uuid) returns boolean language sql as $$select true$$;
create table command_capture(payload jsonb);
create function create_financial_event_command(jsonb) returns uuid language plpgsql as $$begin insert into command_capture values($1);return '${id(20)}';end$$;
create function transition_financial_event(uuid,text,text) returns void language plpgsql as $$begin return;end$$;`);
const extra=JSON.parse(await readFile('tests/migration-history/native-reversal-source-columns.json','utf8'));
for(const name of new Set(extra.map(x=>x.table_name))){
 await db.exec(`create table if not exists public.${name}()`);
 for(const c of extra.filter(x=>x.table_name===name)) {
  const type=/^(uuid|text|integer|numeric|boolean|date|timestamp|jsonb|bigint|character|double|ARRAY)/.test(c.data_type)?c.data_type:'text';
  await db.exec(`alter table public.${name} add column if not exists ${c.column_name} ${type}`);
 }
}
await db.exec(`create function private.financial_reporting_legacy_events(uuid,date,date) returns jsonb language sql as $$select '[]'::jsonb$$;
create function private.financial_nonposting_reschedule(uuid,uuid) returns boolean language sql as $$select false$$;`);
for(const f of defs)await db.exec(f.definition);
await db.exec(await readFile(root+'supabase/migrations/20261109201129_native_debt_reversal_components.sql','utf8'));
await db.exec(`insert into financial_events(id,organization_id,status,source_module,event_type,event_date,base_currency) values('${id(1)}','${id(2)}','ACTUAL','DEBT_CONTRACTS','ADJUSTMENT','2026-01-01','SAR'),('${id(3)}','${id(2)}','COMMITTED','DEBT_OPERATIONS','REVERSAL','2026-02-01','SAR');
insert into liquidity_settlements(id,financial_event_id,organization_id,status,amount,base_amount,currency,base_currency,exchange_rate,direction) values('${id(4)}','${id(1)}','${id(2)}','POSTED',300,300,'SAR','SAR',1,'INFLOW');
insert into financial_event_lines(id,event_id,organization_id,line_number,classification_id,amount,base_amount,currency,exchange_rate,cash_direction,metadata) values
('${id(5)}','${id(1)}','${id(2)}',1,'${id(10)}',100,100,'SAR',1,'INFLOW','{"source_role":"PRINCIPAL"}'),
('${id(6)}','${id(1)}','${id(2)}',2,'${id(10)}',200,200,'SAR',1,'INFLOW','{"source_role":"INTEREST"}');`);
const payload={organization_id:id(2),request_id:id(11),kind:'REVERSE',target_id:id(1),date:'2026-02-01',reason:'Native reversal test'};
await db.query('select private.prepare_debt_operation($1)',[JSON.stringify(payload)]);
const captured=(await db.query('select payload from command_capture')).rows[0].payload;
assert.equal(captured.lines.length,2);assert.deepEqual(captured.lines.map(l=>l.amount),[100,200]);
assert.equal(captured.lines[0].metadata.reversal_of_line_id,id(5));assert.equal(captured.lines[1].metadata.reversal_of_line_id,id(6));
assert.ok(captured.lines.every(l=>l.cash_direction==='OUTFLOW'));
await db.exec(`insert into debt_operation_requests(id,organization_id,financial_event_id,target_id,kind,execution_state) values('${id(12)}','${id(2)}','${id(3)}','${id(1)}','REVERSE','PENDING');
insert into financial_event_links values('${id(2)}','${id(3)}','REVERSAL_OF','${id(1)}');`);
for(let i=0;i<captured.lines.length;i++) {
 const l=captured.lines[i];
 await db.query('insert into financial_event_lines(id,event_id,organization_id,line_number,classification_id,amount,base_amount,currency,exchange_rate,cash_direction,metadata) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[id(30+i),id(3),id(2),l.line_number,l.classification_id,l.amount,l.base_amount,l.currency,l.exchange_rate,l.cash_direction,JSON.stringify(l.metadata)]);

}
for(let i=0;i<2;i++)assert.equal((await db.query('select (private.financial_native_reversal_original($1,$2)).id id',[id(2),id(30+i)])).rows[0].id,id(5+i));
await assert.rejects(db.query('select private.post_debt_operation($1)',[id(12)]),/DEBT_OPERATION_ACCESS_DENIED/);
await db.exec(`update financial_events set status='ACTUAL' where id='${id(3)}';
update financial_event_lines set vat_amount=0;
insert into liquidity_settlements(id,financial_event_id,organization_id,status,amount,base_amount,currency,base_currency,exchange_rate,direction) values('${id(40)}','${id(3)}','${id(2)}','POSTED',300,300,'SAR','SAR',1,'OUTFLOW');`);
const normalized=(await db.query("select private.financial_reporting_events($1,'2026-02-01','2026-02-28') events",[id(2)])).rows[0].events;
assert.equal(normalized.length,1);
assert.equal(normalized[0].lines.length,2);
assert.ok(normalized[0].lines.every(l=>l.cashDirection==='INFLOW'&&l.recognitionSign===-1&&l.classificationId.startsWith(id(10))));
assert.deepEqual(normalized[0].lines.map(l=>l.id),[id(30)+':PRINCIPAL',id(31)+':INTEREST']);
const resolved=normalized[0].lines.map((l,i)=>({lineId:l.originalLineId,classificationId:l.classificationId,cashDirection:l.cashDirection,debitAccountId:'100001',creditAccountId:i?'220002':'220001',cashActivity:'FINANCING',ruleId:'original:'+i}));
await db.query('insert into private.financial_event_posting_resolutions values($1,$2,$3)',[id(2),id(1),JSON.stringify(resolved)]);
const result=(await db.query('select private.financial_resolve_event_posting($1,$2,$3,$4,true) lines',[id(2),JSON.stringify(normalized[0]),id(41),'[]'])).rows[0].lines;
assert.deepEqual(result.map(l=>l.creditAccountId),['220001','220002']);
assert.deepEqual(result.map(l=>l.lineId),[id(30)+':PRINCIPAL',id(31)+':INTEREST']);
await db.exec(`update financial_event_lines set base_amount=99 where id='${id(30)}'`);
await assert.rejects(db.query('select private.financial_native_reversal_original($1,$2)',[id(2),id(30)]),/REPORTING_NATIVE_REVERSAL_SOURCE_INVALID/);
const delta=JSON.parse(await readFile('tests/migration-history/native-reversal-schema-delta.json','utf8'));
const actual=(await db.query("select 'private.'||proname||'('||pg_get_function_identity_arguments(oid)||')' object_key,md5(pg_get_functiondef(oid)) fingerprint from pg_proc where pronamespace='private'::regnamespace")).rows;
for(const row of delta.upserts)assert.equal(actual.find(x=>x.object_key===row.object_key)?.fingerprint,row.fingerprint,row.object_key);
console.log('PASS: exact deployed functions patched; native multipart preparation; source identity; tamper rejection; aggregate permission limit; later-window normalization; exact original account resolution');
}catch(e){console.error(e.message,e.where);process.exitCode=1}finally{await db.close()}
