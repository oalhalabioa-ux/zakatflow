// Only a disposable local Supabase stack is allowed. No hosted keys or URLs.
import { strict as assert } from 'node:assert';
import { randomUUID, randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const api = process.env.API_URL;
const anon = process.env.ANON_KEY;
const service = process.env.SERVICE_ROLE_KEY;
const report = process.env.PR302_REPORT_DIR;
if (api !== 'http://127.0.0.1:54321' || !anon || !service || !report) {
  throw new Error('Expected the disposable local Supabase API and local keys');
}
const admin = createClient(api, service, {auth:{persistSession:false,autoRefreshToken:false}});
const sql = (query) => {
  const r = spawnSync('psql', ['postgresql://postgres:postgres@127.0.0.1:54322/postgres', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', query], {encoding:'utf8'});
  if (r.status !== 0) throw new Error(`Local SQL fixture or assertion failed: ${r.stderr}`);
  return r.stdout.trim();
};
const rpc = async (client, name, args) => {
  const {data,error} = await client.rpc(name,args);
  if (error) throw new Error(`${name}: ${error.code || 'ERROR'} ${error.message}`);
  return data;
};
const makeUser = async (n) => {
  const email = `pr302-${n}-${randomUUID()}@example.invalid`;
  const password = randomBytes(32).toString('hex');
  const {data,error} = await admin.auth.admin.createUser({email,password,email_confirm:true});
  if (error || !data.user) throw new Error(`Local Auth createUser failed: ${error?.message}`);
  const client = createClient(api, anon, {auth:{persistSession:false,autoRefreshToken:false}});
  const login = await client.auth.signInWithPassword({email,password});
  if (login.error || !login.data.session) throw new Error(`Local Auth sign-in failed: ${login.error?.message}`);
  return {id:data.user.id,client};
};


const progress = {status:'RUNNING',authenticatedCases:[],scopeMatrix:[],limitations:['This tests the financial event model, not a general double-entry journal.','Year-boundary source timestamps are seeded locally with SQL; authenticated API concurrency is tested separately.']};
const save = () => {mkdirSync(report,{recursive:true});writeFileSync(`${report}/concurrency.json`,JSON.stringify(progress,null,2));};
const sqlAsync = query => new Promise((resolve,reject) => {
  const child=spawn('psql',['postgresql://postgres:postgres@127.0.0.1:54322/postgres','-X','-qAt','-v','ON_ERROR_STOP=1','-c',query]);
  let out='',err='';child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>err+=x);child.on('error',reject);child.on('close',code=>code===0?resolve(out.trim()):reject(new Error(err)));
});
async function main() {
  save();
  const users=await Promise.all([makeUser(1),makeUser(2)]);
  assert.notEqual(users[0].id,users[1].id);
  const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const companies=[];
  for(let index=0;index<2;index++){
    const org=randomUUID(),party=randomUUID();
    sql(`insert into public.organizations(id,owner_user_id,name,base_currency,entity_type,status) values ('${org}','${users[0].id}','PR302 disposable company ${index}','SAR','FAMILY','ACTIVE');
      insert into public.organization_members(organization_id,user_id,role,status) values ('${org}','${users[0].id}','OWNER','ACTIVE'),('${org}','${users[1].id}','OWNER','ACTIVE') on conflict(organization_id,user_id) do update set role='OWNER',status='ACTIVE';
      insert into public.liquidity_counterparties(id,organization_id,name,party_type,created_by) values ('${party}','${org}','PR302 synthetic party','OTHER','${users[0].id}');`);
    const opened=await rpc(users[0].client,'open_financial_account',{p_payload:{request_id:randomUUID(),scope:'ORGANIZATION',organization_id:org,type:'BANK',name:'PR302 local bank',currency:'SAR',opening_balance:1000,opening_date:date,fx_rate:1}});
    assert.match(opened.id,/^[0-9a-f-]{36}$/i);
    companies.push({org,party,bank:opened.id});
  }
  for(const [companyIndex,c] of companies.entries()){
    for(const side of ['PAYABLE','RECEIVABLE']){
      const expectedBalance=side==='PAYABLE'?1200:1000;
      const expectedPrefix=side==='PAYABLE'?'LR':'LG';
      const observations=[];
      const payloads=users.map((_,n)=>({organization_id:c.org,request_id:randomUUID(),kind:'LOAN',mode:'NEW',side,counterparty_id:c.party,entity_id:null,account_id:c.bank,category:side==='PAYABLE'?'O_AP_LOAN':'O_AR_LOAN',description:`PR302 concurrent ${side} ${n}`,reference:`PR302-${companyIndex}-${side}-${n}`,date,currency:'SAR',exchange_rate:1,principal:100,schedule:[{amount:100,due_date:date}]}));
      const monitor=setInterval(()=>observations.push(JSON.parse(sql(`select json_build_object('active',count(*),'backends',coalesce(json_agg(pid),'[]'::json),'waiting',count(*) filter(where wait_event_type='Lock')) from pg_stat_activity where pid<>pg_backend_pid() and backend_type='client backend' and state='active' and query ilike '%create_debt_contract%'`))),40);
      let created;
      try{created=await Promise.all(users.map((u,n)=>rpc(u.client,'create_debt_contract',{p_payload:payloads[n]})));}finally{clearInterval(monitor);}
      assert.notEqual(created[0].id,created[1].id);assert.notEqual(created[0].eventId,created[1].eventId);
      const overlap=observations.find(x=>Number(x.active)>=2&&new Set(x.backends).size>=2);
      assert.ok(overlap,'Both first issuance RPCs must be active on different database backends');
      await Promise.all(created.map((x,n)=>rpc(users[1-n].client,'approve_financial_event',{p_event_id:x.eventId,p_note:'PR302 cross approval'})));
      const posted=await Promise.all(created.map((x,n)=>rpc(users[n].client,'post_debt_contract',{p_id:x.id})));
      assert.ok(posted.every(x=>x.status==='ACTUAL'));
      const ids=created.map(x=>x.id),events=created.map(x=>x.eventId);
      const readStats=()=>JSON.parse(sql(`select json_build_object(
        'balance',(select current_balance from public.liquidity_accounts where id='${c.bank}'),
        'vouchers',(select count(*) from public.voucher_numbers where source_table='debt_contracts' and source_id in ('${ids[0]}','${ids[1]}')),
        'distinct_numbers',(select count(distinct document_number) from public.voucher_numbers where source_table='debt_contracts' and source_id in ('${ids[0]}','${ids[1]}')),
        'min_sequence',(select min(sequence) from public.voucher_numbers where source_table='debt_contracts' and source_id in ('${ids[0]}','${ids[1]}')),
        'max_sequence',(select max(sequence) from public.voucher_numbers where source_table='debt_contracts' and source_id in ('${ids[0]}','${ids[1]}')),
        'prefix_count',(select count(*) from public.voucher_numbers where source_table='debt_contracts' and source_id in ('${ids[0]}','${ids[1]}') and prefix='${expectedPrefix}' and issue_year=extract(year from now() at time zone 'Asia/Riyadh')),
        'settlements',(select count(*) from public.liquidity_settlements where financial_event_id in ('${events[0]}','${events[1]}') and status='POSTED'),
        'settlement_sum',(select coalesce(sum(base_amount),0) from public.liquidity_settlements where financial_event_id in ('${events[0]}','${events[1]}') and status='POSTED'),
        'event_count',(select count(*) from public.financial_events where id in ('${events[0]}','${events[1]}') and status='ACTUAL'),
        'line_count',(select count(*) from public.financial_event_lines where event_id in ('${events[0]}','${events[1]}')),
        'line_sum',(select coalesce(sum(base_amount),0) from public.financial_event_lines where event_id in ('${events[0]}','${events[1]}')),
        'obligation_sum',(select coalesce(sum(settleable_base_amount),0) from public.financial_event_obligations where event_id in ('${events[0]}','${events[1]}')),
        'commands',(select count(*) from public.financial_event_command_registry where financial_event_id in ('${events[0]}','${events[1]}') and command_type='DEBT_CONTRACT_POST'))::text`));
      const stats=readStats();
      for(const field of ['vouchers','distinct_numbers','prefix_count','settlements','event_count','line_count','commands'])assert.equal(Number(stats[field]),2,field);
      for(const field of ['settlement_sum','line_sum','obligation_sum'])assert.equal(Number(stats[field]),200,field);
      assert.equal(Number(stats.balance),expectedBalance);assert.equal(Number(stats.min_sequence),1);assert.equal(Number(stats.max_sequence),2);
      const replay=await Promise.all(created.flatMap(x=>users.map(u=>rpc(u.client,'post_debt_contract',{p_id:x.id}))));
      assert.ok(replay.every(x=>x.replay===true));assert.deepEqual(readStats(),stats);
      const creationReplay=await Promise.all(users.map((u,n)=>rpc(u.client,'create_debt_contract',{p_payload:payloads[n]})));
      assert.deepEqual(creationReplay.map(x=>x.id),ids);assert.deepEqual(readStats(),stats);
      progress.authenticatedCases.push({company:companyIndex,side,prefix:expectedPrefix,status:'PASS',serverOverlap:overlap,replayUnchanged:true,...stats});save();
    }
  }
  // Engine-level annual boundaries. These source rows are synthetic SQL fixtures;
  // the four user/API cases above independently exercise real Auth and RLS.
  const counterSnapshot=()=>JSON.parse(sql("select coalesce(json_agg(row_to_json(c) order by scope_key,prefix,issue_year),'[]'::json) from private.voucher_sequence_counters c where prefix<>'CF'"));
  const otherCounters=counterSnapshot();
  for(const [companyIndex,c] of companies.entries()){
    for(const [year,stamp] of [[2025,'2025-12-31T20:59:59Z'],[2026,'2025-12-31T21:00:00Z']]){
      const before=Number(sql(`select coalesce((select last_value from private.voucher_sequence_counters where scope_key='O:${c.org}' and prefix='CF' and issue_year=${year}),0)`));
      const ids=users.map(()=>randomUUID());
      await Promise.all(users.map((u,n)=>sqlAsync(`begin; insert into public.liquidity_flows(id,organization_id,direction,flow_type,title,due_date,amount,currency,base_amount,status,source,created_by,created_at) values ('${ids[n]}','${c.org}','INFLOW','OTHER','PR302 boundary fixture','2026-01-01',1,'SAR',1,'EXPECTED','MANUAL','${u.id}','${stamp}'::timestamptz); commit;`)));
      const rows=JSON.parse(sql(`select json_agg(json_build_object('year',issue_year,'sequence',sequence,'prefix',prefix) order by sequence) from public.voucher_numbers where source_table='liquidity_flows' and source_id in ('${ids[0]}','${ids[1]}')`));
      assert.equal(rows.length,2);assert.ok(rows.every(x=>x.year===year&&x.prefix==='CF'));assert.deepEqual(rows.map(x=>Number(x.sequence)),[before+1,before+2]);
      assert.equal(Number(sql(`select current_balance from public.liquidity_accounts where id='${c.bank}'`)),1000);
      progress.scopeMatrix.push({company:companyIndex,year,prefix:'CF',status:'PASS',sequences:rows.map(x=>x.sequence),cashUnchanged:true});save();
    }
  }
  assert.deepEqual(counterSnapshot(),otherCounters,'Year/scope flow allocation must not consume other voucher types');
  const duplicates=Number(sql("select count(*) from (select scope_key,prefix,issue_year,sequence from public.voucher_numbers where canonical_id is null group by 1,2,3,4 having count(*)>1) d"));
  assert.equal(duplicates,0);
  progress.status='PASS';progress.noDuplicateCanonicalNumbers=true;progress.otherTypeCountersUnchanged=true;save();
}
main().catch(error=>{progress.status='FAIL';progress.error=String(error.message);save();console.error('PR302 local concurrency test failed:',error.message);process.exitCode=1;});
