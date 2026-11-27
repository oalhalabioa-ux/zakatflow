// Replay the real assessment and cycle services against a disposable in-memory database.
// Run after npm ci with PGLITE_MODULE_DIR pointing at @electric-sql/pglite's dist folder.
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import Decimal from 'decimal.js';
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../../', import.meta.url))
assert.ok(process.env.PGLITE_MODULE_DIR, 'PGLITE_MODULE_DIR must point at an installed PGlite dist folder')
const pglitePath = file => pathToFileURL(resolve(process.env.PGLITE_MODULE_DIR, file)).href
const { PGlite, types } = await import(pglitePath('index.js'))
const { pgcrypto } = await import(pglitePath('contrib/pgcrypto.js'))
const db = new PGlite('memory://',{extensions:{pgcrypto},parsers:{[types.DATE]:value=>value}})
const migrationSetup = `
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create schema extensions;
create extension pgcrypto with schema extensions;
create table auth.users(id uuid primary key,email character varying,email_confirmed_at timestamptz,
 raw_user_meta_data jsonb,created_at timestamptz default now(),last_sign_in_at timestamptz,deleted_at timestamptz,banned_until timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}')$$;
grant usage on schema auth,extensions to anon,authenticated,service_role;
alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
alter default privileges in schema public grant all on sequences to anon,authenticated,service_role;
set search_path=public,extensions;
`
await db.exec(migrationSetup)
const dir=root+'/supabase/migrations'
for(const migration of (await readdir(dir)).filter(x=>x.endsWith('.sql')).sort()){
 try { await db.exec(await readFile(dir+'/'+migration,'utf8')) }
 catch(error){ console.error(migration,error); throw error }
}
async function loadService(){
const built=await build({stdin:{contents:`export {calculateAndSaveAssessment,confirmAssessment} from './services/assessments.ts'; export {closeCycle} from './services/zakat-cycles.ts';`,resolveDir:root,sourcefile:'combined-test-entry.ts'},write:false,bundle:true,format:'esm',platform:'node',nodePaths:[root+'/node_modules'],tsconfig:root+'/tsconfig.json',plugins:[{name:'witness-environment',setup(b){
 b.onResolve({filter:/^\.\/(auth|reference-prices|nisab-evidence)$|^@\/lib\/zakat-view-refresh$/},x=>({path:x.path,namespace:'env'}))
 b.onLoad({filter:/.*/,namespace:'env'},x=>({contents:x.path==='./auth'?'export const requireUser=()=>globalThis.qaWitnessUser()':x.path==='@/lib/zakat-view-refresh'?'export const invalidateZakatViews=()=>{}':x.path==='./nisab-evidence'?'export const nisabEvidence=()=>{throw Error("Unexpected first-cycle evidence request")}':'export const fetchReferenceMetalPrices=()=>{throw Error("Unexpected live price request")}'}))
}}]})
return await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].contents).toString('base64'))

}

function client(){
 function from(table){
  const filters=[],order=[]
  let limit, singular, insert
  const q={
   select:()=>q,
   insert:row=>{insert=row;return q},
   eq:(key,v)=>{filters.push([key,'=',v]);return q},
   gt:(key,v)=>{filters.push([key,'>',v]);return q},
   in:(key,v)=>{filters.push([key,'IN',v]);return q},
   order:(key,{ascending})=>{order.push([key,ascending]);return q},
   limit:v=>{limit=v;return q},
   single:()=>{singular='single';return q},
   maybeSingle:()=>{singular='maybe';return q},
   then:async (ok, fail)=>{
    try{
     const expressions=[], args=[]
     for(const [column,op,input] of filters){
      if(op==='IN'){expressions.push(`t.${column} IN (${input.map(v=>{args.push(v);return '$'+args.length}).join(',')})`)}
      else{args.push(input);expressions.push(`t.${column}${op}$${args.length}`)}
     }
     if(insert){
      const keys=Object.keys(insert)
      const values=Object.values(insert).map(value=>value && typeof value==='object'?JSON.stringify(value):value)
      const rows=(await db.query(`INSERT INTO public.${table}(${keys.join(',')}) VALUES(${keys.map((_,i)=>'$'+(i+1)).join(',')}) RETURNING *`,values)).rows
      return ok({data:singular?rows[0]:rows})
     }
     const projection=table==='lots'?`t.*, (select to_jsonb(a) from public.asset_accounts a where a.id=t.asset_account_id) AS asset_accounts, (select jsonb_build_object('id',v.id,'transaction_date',v.transaction_date,'transaction_type',v.transaction_type,'sale_id',v.metadata->>'sale_transaction_id') from public.transactions v where v.id=t.source_transaction_id) AS transactions`:'t.*'
     const rows=(await db.query(`SELECT ${projection} FROM public.${table} t${expressions.length?' WHERE '+expressions.join(' AND '):''}${order.length?' ORDER BY '+order.map(([key,ascending])=>key+(ascending?' ASC':' DESC')).join(','):''}${limit?' LIMIT '+Number(limit):''}`,args)).rows
     if(singular==='single')assert.equal(rows.length,1,table)
     return ok({data:singular?rows[0]??null:rows})
    } catch (e){return fail(e)}
   }
  }
  return q
 }
 async function rpc(name,args){
  const cast={p_calendar:'text',p_cycle:'uuid',p_method:'uuid',p_cutoff:'date',p_assessment:'jsonb',p_lines:'jsonb',p_revision_of:'uuid',p_cycle_id:'uuid',p_final_assessment_id:'uuid'}
  const entries=Object.entries(args).filter(([,value])=>value!==undefined)
  const sqlArgs=entries.map(([key],i)=>key+'=> $'+(i+1)+'::'+cast[key]).join(',')
  const values=entries.map(([key,value])=>cast[key]==='jsonb'?JSON.stringify(value):value)
  const scalar=['save_zakat_assessment_snapshot','close_zakat_cycle','personal_zakat_assessment_context'].includes(name)
  const data=(await db.query(scalar?`SELECT public.${name}(${sqlArgs}) AS result`:`SELECT * FROM public.${name}(${sqlArgs})`,values)).rows
  return {data:scalar?data[0].result:data}
 }
 return {from,rpc}
}



const {calculateAndSaveAssessment,confirmAssessment,closeCycle}=await loadService()
const start = '2024-02-03', originalDue = '2025-02-03';
const netTotal = positions => positions.reduce((value, position) => value.plus(position.netBase), new Decimal(0)).toNumber();
for(const code of ['INDEPENDENT_LOTS','UNIFIED_HAWL']){
 for(const scenario of ['CONTINUOUS_GOOD','BAD_TO_GOOD','NISAB_RECOVERY']){
  const reclassified = scenario !== 'CONTINUOUS_GOOD';
  const thresholdRecovery = scenario === 'NISAB_RECOVERY';
  const due = thresholdRecovery ? '2025-02-08' : originalDue;
  const recoveryStart = '2024-02-08';
  await db.exec('begin');
  try{
   const actor=randomUUID(),gold=randomUUID(),bank=randomUUID(),middle=randomUUID(),finalBank=randomUUID();
   await db.query("insert into auth.users(id,email) values($1,$2)",[actor,actor+'@invoice-consumer.invalid']);
   const {id:method}=(await db.query("update public.zakat_methods set calendar_type='GREGORIAN' where code=$1 returning id",[code])).rows[0];
   await db.query("insert into public.profiles(id,base_currency,zakat_method_id,nisab_standard) values($1,'SAR',$2,'GOLD') on conflict(id) do update set base_currency=excluded.base_currency,zakat_method_id=excluded.zakat_method_id,nisab_standard=excluded.nisab_standard",[actor,method]);
   await db.query("insert into public.user_settings(user_id,hawl_nisab_policy) values($1,'CONTINUOUS') on conflict(user_id) do update set hawl_nisab_policy='CONTINUOUS'",[actor]);
   await db.query("insert into public.personal_income_issuers(owner_id,vat_number,address,valid_from,valid_until) values($1,'300000000000003','Synthetic address','2023-01-01','2099-12-31')",[actor]);
   await db.query(`insert into public.asset_accounts(id,user_id,asset_type,name,currency,unit,ownership_scope,is_zakatable,metadata)
   values($2,$1,'GOLD','Synthetic gold','SAR','g','PERSONAL',true,'{"karat":24}'),
       ($3,$1,'BANK','Synthetic A','SAR','SAR','PERSONAL',true,'{}'),($4,$1,'BANK','Synthetic B','SAR','SAR','PERSONAL',true,'{}'),
       ($5,$1,'BANK','Synthetic C','SAR','SAR','PERSONAL',true,'{}')`,[actor,gold,bank,middle,finalBank]);
   const goldMovement=(await db.query("insert into public.transactions(user_id,asset_account_id,transaction_type,transaction_date,quantity,currency,base_currency,base_value) values($1,$2,'PURCHASE',$3,90,'SAR','SAR',36000) returning id",[actor,gold,start])).rows[0].id;
   await db.query("insert into public.lots(user_id,asset_account_id,source_transaction_id,acquisition_date,hawl_start_date,original_quantity,remaining_quantity,original_value_base,remaining_value_base) values($1,$2,$3,$4,$4,90,90,36000,36000)",[actor,gold,goldMovement,start]);
   await db.query(`insert into public.market_prices(asset_type,instrument_code,price_per_unit,currency,valuation_date,source)
     select 'GOLD','XAU',400,'SAR',d::date,'SYNTHETIC_INVOICE_HAWL'
     from generate_series($1::date::timestamp,$2::date::timestamp,interval '1 day') d`,[start,due]);
   const cycle=(await db.query(`insert into public.zakat_hawl_cycles(user_id,cycle_no,nisab_standard,nisab_reached_date,hawl_start_date,hawl_due_date,status,snapshot)
    values($1,1,'GOLD',$2,$2,$3,'ACTIVE',$4::jsonb) returning id`,[actor,start,originalDue,JSON.stringify({personal_start_policy:'FIRST_NISAB_V1',nisabEvidence:{status:'PROVEN',day:start,movementIds:[goldMovement]}})])).rows[0].id;
   await db.query("select set_config('request.jwt.claim.sub',$1,true)",[actor]);
   await db.exec('set local role authenticated');
   const rpc=async(name,params)=>{
    const args=params.map((_,i)=>'$'+(i+1)).join(',');
    return (await db.query('select to_jsonb(public.'+name+'('+args+')) result',params)).rows[0].result;
   };
   await db.exec("insert into public.personal_income_profiles(seller_name,vat_number,effective_from) values('Synthetic practice','300000000000003','2024-01-01')");
   const term=(invoice,category,date)=>rpc('record_personal_invoice_hawl_event',[invoice,randomUUID(),'2024-02-03',category,date]);
   const invoice=await rpc('record_personal_income_document',[randomUUID(),'SIMPLIFIED','2024-02-01','Synthetic client','Synthetic service',null,10000,1500]);
   await term(invoice.id,'GOOD','2024-02-01');
   const before=await rpc('personal_invoice_hawl_positions_at_cutoff',['2024-02-02']);
   assert.equal(Number(before[0].netBase),0);
   const own=client();
   const assess=assessment_date=>calculateAndSaveAssessment({assessment_date,nisab_standard:'GOLD',gold_price:400,silver_price:5});
   globalThis.qaWitnessUser=()=>({user:{id:actor},supabase:own});
   const atInvoiceDue=await assess('2024-02-03');
   assert.equal(Number(atInvoiceDue.assessment.calculation_snapshot.nisabQualificationValue),46000);
   assert.equal(netTotal(atInvoiceDue.assessment.calculation_snapshot.invoiceHawlEvidence),10000);
   if(thresholdRecovery){
    const excludedBank = randomUUID();
    await db.query(`insert into public.asset_accounts(id,user_id,asset_type,name,currency,unit,ownership_scope,is_zakatable)
     values($1,$2,'BANK','Synthetic non-zakatable proceeds','SAR','SAR','PERSONAL',false)`,[excludedBank,actor]);
    await rpc('post_sale_with_proceeds',[actor,gold,excludedBank,'2024-02-04',20,8000,'SAR','SAR',8000]);
   }
   if(reclassified)await term(invoice.id,'BAD','2024-02-05');
   const collection={action:'COLLECT',source_id:invoice.receivable_id,destination_id:bank,request_id:randomUUID(),date:'2024-02-06',amount:4000,notes:'Synthetic partial invoice collection'};
   const receipt=await rpc('transfer_personal_financial_account',[JSON.stringify(collection)]);
   assert.deepEqual(await rpc('transfer_personal_financial_account',[JSON.stringify(collection)]),receipt);
   const move=(source,destination,when,amount)=>rpc('transfer_personal_financial_account',[JSON.stringify({action:'TRANSFER',source_id:source,destination_id:destination,request_id:randomUUID(),date:when,amount,notes:'Synthetic descendant transfer'})]);
   await move(bank,middle,'2024-02-07',1000);
   await move(middle,finalBank,'2024-02-08',500);
   if(reclassified)await term(invoice.id,'GOOD','2024-02-08');
   const cutoff=await rpc('personal_invoice_hawl_positions_at_cutoff',['2024-02-06']);
   assert.equal(netTotal(cutoff),reclassified?3478.26:10000);
   const early=await assess(thresholdRecovery?originalDue:'2025-02-02');
   assert.equal(Number(early.assessment.zakat_due),0);
   if(thresholdRecovery){
    const continuity=early.assessment.calculation_snapshot.hawlContinuity;
    assert.equal(continuity.effectiveStart,recoveryStart);
    assert.equal(continuity.effectiveDue,due);
    assert.equal((await db.query('select status from public.zakat_hawl_cycles where id=$1',[cycle])).rows[0].status,'ACTIVE');
   }
   await db.exec('savepoint early_close');
   await assert.rejects(confirmAssessment(early.assessment.id),/CYCLE_HAWL_NOT_COMPLETED/);
   await db.exec('rollback to savepoint early_close');
   const proposed=await assess(due);
   const entries=proposed.assessment.calculation_snapshot.invoiceHawlEvidence;
   assert.equal(entries.length,4);
   assert.equal(entries.find(x=>x.kind==='RECEIVABLE').netBase,6521.74);
   assert.equal(netTotal(entries.filter(x=>x.kind==='RECEIPT_CASH')),3478.26);
   const qualification=thresholdRecovery?38000:46000;
   assert.equal(Number(proposed.assessment.calculation_snapshot.nisabQualificationValue),qualification);
   const expected=thresholdRecovery?950:reclassified&&code==='INDEPENDENT_LOTS'?900:1150;
   assert.equal(Number(proposed.assessment.zakat_due),expected);
   assert.equal(proposed.assessment.hawl_cycle_id,cycle);
   await term(invoice.id,'EXCELLENT','2024-02-08');
   await db.exec('savepoint stale_close');
   const close=code==='INDEPENDENT_LOTS'?id=>confirmAssessment(id):id=>closeCycle(cycle,id);
   await assert.rejects(close(proposed.assessment.id),/HAWL_CONTINUITY_(RECALCULATION|INVOICE_RECALCULATION)_REQUIRED/);
   await db.exec('rollback to savepoint stale_close');
   const fresh=await assess(due);
   await close(fresh.assessment.id);
   const finalized=(await db.query("select status,final_assessment_id,final_zakat_due from public.zakat_hawl_cycles where id=$1",[cycle])).rows[0];
   assert.equal(finalized.status,'CLOSED');
   assert.equal(finalized.final_assessment_id,fresh.assessment.id);
   assert.equal(Number(finalized.final_zakat_due),expected);
   assert.equal(Number((await db.query('select count(*) n from public.zakat_hawl_cycles where user_id=$1',[actor])).rows[0].n),1);
   assert.equal(Number((await db.query('select count(*) n from public.transactions where transfer_id=$1',[receipt.transfer_id])).rows[0].n),2);
   const collectionDay=thresholdRecovery?'2025-02-09':'2025-02-04';
   const nextDay=thresholdRecovery?'2025-02-10':'2025-02-05';
   const remaining = {...collection, request_id:randomUUID(), date:collectionDay, amount:7500}
   const lastReceipt=await rpc('transfer_personal_financial_account',[JSON.stringify(remaining)])
   assert.deepEqual(await rpc('transfer_personal_financial_account',[JSON.stringify(remaining)]),lastReceipt)
   const nextContext=await rpc('personal_zakat_assessment_context',[null,method,nextDay])
   assert.ok(nextContext.invoicePositions.every(position=>position.kind==='RECEIPT_CASH'))
   assert.equal(netTotal(nextContext.invoicePositions),10000)
   const latest=nextContext.invoicePositions.find(position=>position.collectedOn===collectionDay)
   assert.equal(latest.netBase,6521.74)
   const debtWasCovered=thresholdRecovery||!reclassified||code==='UNIFIED_HAWL'
   assert.equal(latest.coveredThrough,debtWasCovered?due:null)
   assert.equal(latest.hawlStartDate,debtWasCovered?due:'2024-02-08')
   assert.equal(Number((await db.query('select final_zakat_due from public.zakat_hawl_cycles where id=$1',[cycle])).rows[0].final_zakat_due),expected)
   await db.exec('savepoint repeat_close')
   await assert.rejects(close(fresh.assessment.id),/ACTIVE_CYCLE_NOT_FOUND|FINAL_ASSESSMENT_NOT_IN_CYCLE|CYCLE_NOT_ACTIVE/)
   await db.exec('rollback to savepoint repeat_close')
   console.log(JSON.stringify({code,scenario,assessment:fresh.assessment.id,cycle,due,invoicePositions:entries.length,
    qualification,final:expected,staleCloseRejected:true,earlyCloseRejected:true,netCash:3478.26,netReceivable:6521.74,netAfterFullCollection:10000,finalCoverageCarried:debtWasCovered}));
  }catch(e){
   console.error('FAIL',code,scenario,e.message,e.code,e.where,e.detail);
   process.exitCode=1;
  }finally{await db.exec('rollback')}
 }
}
await db.close();
