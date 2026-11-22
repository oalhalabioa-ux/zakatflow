const {PGlite}=require('@electric-sql/pglite');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');

const migration=name=>readFileSync(join(__dirname,'../../supabase/migrations',name),'utf8');
const id=number=>'00000000-0000-4000-8000-'+String(number).padStart(12,'0');
const [owner,gold,bank,otherUser,home,method]=[1,2,3,4,5,6].map(id);

const captureSources=process.argv.includes('--capture-sources');

async function main(){
 const db=new PGlite();
 try{
  await db.exec(`create schema auth; create schema private;
   create table auth.users(id uuid primary key);
   create function auth.uid() returns uuid language sql stable as
    $$select nullif(current_setting('test.user',true),'')::uuid$$;
   create role anon; create role authenticated; create role service_role;`);
  await db.exec(migration('20260915195428_001_schema.sql')
   .split('create table if not exists audit_logs')[0]
   .replace('create extension if not exists pgcrypto;',''));
  await db.exec(migration('20260915195428_001_schema.sql').match(/create table if not exists audit_logs[^;]+;/)[0]);
  await db.exec(migration('20260916151251_nisab_aware_hawl_and_cycle_tracking.sql')
   .split('create index if not exists idx_hawl_cycles_user_due')[0]);
  await db.exec(migration('20260917105102_lot_hawl_valuation_snapshots.sql'));
  await db.exec(`alter table transactions add organization_id uuid, add entity_id uuid;
   alter table zakat_payments add cash_transaction_id uuid;
   alter table asset_accounts add organization_id uuid,add ownership_scope text default 'PERSONAL';
   alter table lots add organization_id uuid;
   alter table zakat_assessments add assessment_kind text;
   alter table zakat_assessment_lines add valuation_snapshot jsonb;
   alter table zakat_hawl_cycles add final_assessment_id uuid;
   insert into auth.users values('${owner}'),('${otherUser}');
   insert into currencies(code,name_ar,name_en) values('SAR','SAR','SAR');
   insert into profiles(id,base_currency) values('${owner}','SAR'),('${otherUser}','SAR');
   insert into user_settings(user_id) values('${owner}'),('${otherUser}');
   insert into asset_accounts(id,user_id,asset_type,name,currency,unit,metadata,is_zakatable)
    values('${gold}','${owner}','GOLD','QA gold','SAR','g','{"karat":18}',true),
     ('${bank}','${owner}','BANK','QA bank','SAR','SAR','{}',true),
     ('${home}','${owner}','REAL_ESTATE','QA residence','SAR','unit','{}',false);
   insert into zakat_methods(id,code,name_en,name_ar,calendar_type)
    values('${method}','QA','QA','QA','GREGORIAN');
   alter table lots enable row level security;
   create policy test_lots_self on lots for select to authenticated using (user_id=auth.uid());
   grant usage on schema auth to authenticated;
   grant select on lots,zakat_assessments,zakat_assessment_lines,zakat_hawl_cycles to authenticated;
   select set_config('test.user','${owner}',false);`);
  const legacy=migration('20261010130311_asset_vat_alias_and_personal_exits.sql');
  const start=legacy.indexOf('create or replace function public.post_sale_with_proceeds(');
  await db.exec(legacy.slice(start,legacy.indexOf('create or replace function public.post_asset_disposal(',start)));
  await db.exec(migration('20260919182005_atomic_internal_transfer.sql'));
  const reversal=migration('20261019153443_zakat_payment_cash_account_link.sql');
  await db.exec(reversal.slice(reversal.indexOf('create or replace function public.reverse_transaction(')));
  await db.exec(migration('20261121154238_personal_sale_price_preflight.sql'));
  await db.exec(migration('20261122010000_personal_gold_lot_sales.sql'));
  await db.exec(migration('20261122040000_independent_sale_destination_history.sql'));
  // Enable grouped posting/correction privileges in this disposable fixture alone.
  await db.exec(readFileSync(join(__dirname,'../../supabase/release/personal-gold-sales/enable.sql'),'utf8'));
  await db.exec(migration('20261010192246_cumulative_hawl_periods_and_allocation_repair.sql')
   .split('create or replace function public.save_zakat_assessment_snapshot')[0]);
  for(const [i,date,cost] of [[0,'2025-03-01',3000],[1,'2025-06-01',4000]]){
   const source=id(10+i),lot=id(20+i);
   await db.query(`insert into transactions(id,user_id,asset_account_id,transaction_type,transaction_date,quantity,currency,base_currency,base_value)
    values($1,$2,$3,'PURCHASE',$4,10,'SAR','SAR',$5)`,[source,owner,gold,date,cost]);
   await db.query(`insert into lots(id,user_id,asset_account_id,source_transaction_id,acquisition_date,hawl_start_date,hawl_due_date,
    original_quantity,remaining_quantity,original_value_base,remaining_value_base)
    values($1,$2,$3,$4,$5,$5,public.zakat_next_hawl_date($5,'GREGORIAN'),10,10,$6,$6)`,[lot,owner,gold,source,date,cost]);
  }
  if(captureSources)await db.exec(migration('20261122212401_personal_gold_receipt_hawl_sources.sql'));
  for(const [path,continuity] of [['legacy',true],['grouped',true],...(captureSources?[['legacy',false]]:[])]){

   await db.exec('begin');
   await db.query('update user_settings set zakatable_conversion_continuity=$1 where user_id=$2',[continuity,owner]);
   const saleDate='2026-02-10';
   const result=path==='legacy'
    ?await db.query(`select public.post_sale_with_proceeds($1,$2,$3,$4,12,6000,'SAR','SAR',6000) as sale`,[owner,gold,bank,saleDate])
    :await db.query(`select public.post_personal_gold_lot_sale($1,18,$2,$3,12,500,'FIFO','[]') as sale`,[id(30),bank,saleDate]);
   const sale=result.rows[0].sale;
   assert.equal(Number(sale.realized_gain_base),2200);
   const readSources=()=>db.query(`select source_lot_id,proceeds::int,proceeds_base::int,
    inherited_hawl_start_date::text as hawl,continuity_status,reversed
    from public.personal_gold_receipt_hawl_sources($1)`,[sale.proceeds_transaction_id]).then(result=>result.rows);
   const expectedSources=(first,second,reversed=false)=>[
    {source_lot_id:id(20),proceeds:first,proceeds_base:first,hawl:continuity?'2025-03-01':null,
     continuity_status:continuity?'SOURCE_RECORDED':'NOT_APPLICABLE',reversed},
    {source_lot_id:id(21),proceeds:second,proceeds_base:second,hawl:continuity?'2025-06-01':null,
     continuity_status:continuity?'SOURCE_RECORDED':'NOT_APPLICABLE',reversed},
   ];
   if(captureSources){
    await db.exec('set local role authenticated');
    assert.deepEqual(await readSources(),expectedSources(5000,1000));
    assert.equal((await db.query("select has_schema_privilege('private','usage') as allowed")).rows[0].allowed,false);
    assert.equal((await db.query("select has_function_privilege('anon','public.personal_gold_receipt_hawl_sources(uuid)','execute') as allowed")).rows[0].allowed,false);
    await db.exec('reset role');
   }
   const allocations=await db.query(`select lot_id,quantity::int,value_base::int
    from transaction_allocations where transaction_id=$1 order by lot_id`,[sale.sale_transaction_id]);
   assert.deepEqual(allocations.rows,[
    {lot_id:id(20),quantity:10,value_base:3000},
    {lot_id:id(21),quantity:2,value_base:800},
   ]);
   const inventory=await db.query(`select remaining_quantity::int,remaining_value_base::int
    from lots where asset_account_id=$1 and remaining_quantity>0`,[gold]);
   assert.deepEqual(inventory.rows,[{remaining_quantity:8,remaining_value_base:3200}]);
   const cash=await db.query(`select l.remaining_quantity::int,l.remaining_value_base::int,
    l.hawl_start_date,l.hawl_continuity_source_lot_id,p.lot_id as qualified_period
    from lots l left join public.zakat_lot_hawl_periods('GREGORIAN') p on p.lot_id=l.id
    where l.source_transaction_id=$1`,[sale.proceeds_transaction_id]);
   // Baseline characterization. A correction must replace these null expectations.
   assert.deepEqual(cash.rows,[{remaining_quantity:6000,remaining_value_base:6000,
    hawl_start_date:null,hawl_continuity_source_lot_id:null,qualified_period:null}]);
   const qualification=await db.query(`select l.id,l.remaining_quantity::int as amount,
    p.hawl_start_date::text as start_date
    from lots l join public.zakat_lot_hawl_periods('GREGORIAN') p on p.lot_id=l.id
    where l.remaining_quantity>0 and l.acquisition_date<='2026-04-01' and l.hawl_start_date is not null`);
   assert.deepEqual(qualification.rows,[{id:id(21),amount:8,start_date:'2025-06-01'}]);
   await db.exec('savepoint with_final');
   await db.query(`insert into zakat_assessments(id,user_id,assessment_date,valuation_date,method_id,nisab_standard,
    nisab_quantity,nisab_value_base,zakat_rate,zakat_due,currency,status,assessment_kind)
    values($1,$2,'2026-03-05','2026-03-05',$3,'SILVER',595,595,.025,125,'SAR','CONFIRMED','FINAL')`,[id(50),owner,method]);
   await db.query(`insert into zakat_assessment_lines(assessment_id,lot_id,quantity,eligibility_status,explanation)
    values($1,$2,8,'ELIGIBLE','QA saved line')`,[id(50),id(21)]);
   const finalCheck=await db.query("select public.personal_sale_preflight($1)->>'amount_block' as blocker",[sale.sale_transaction_id]);
   assert.equal(finalCheck.rows[0].blocker,'SALE_CORRECTION_FINAL_ASSESSMENT');
   await db.exec('rollback to savepoint with_final');

   const correction=(request,revision,price)=>db.query(
    'select public.amend_personal_sale_price($1,$2,$3,$4,$5) as correction',
    [sale.sale_transaction_id,request,revision,price,'QA price correction']);
   const corrected=(await correction(id(40),0,450)).rows[0].correction;
   assert.equal(Number(corrected.receipt_amount),5400);
   assert.equal(Number(corrected.gain_base),1600);
   assert.equal(corrected.receipt_id,sale.proceeds_transaction_id);
   if(captureSources)assert.deepEqual(await readSources(),expectedSources(4500,900));
   assert.deepEqual((await correction(id(40),0,450)).rows[0].correction,corrected);
   await db.exec('savepoint with_reversal');
   if(path==='grouped'){
    await db.query('select public.reverse_grouped_gold_sale($1,$2,1,$3)',[sale.sale_transaction_id,id(41),'QA paired reversal']);
   }else{
    await db.query('select public.reverse_transaction($1,$2)',[owner,sale.proceeds_transaction_id]);
    await db.query('select public.reverse_transaction($1,$2)',[owner,sale.sale_transaction_id]);
   }
   const reversed=await db.query(`select asset_account_id,sum(remaining_quantity)::int as quantity,
    sum(remaining_value_base)::int as cost from lots group by asset_account_id order by asset_account_id`);
   assert.deepEqual(reversed.rows,[{asset_account_id:gold,quantity:20,cost:7000},{asset_account_id:bank,quantity:0,cost:0}]);
   if(captureSources)assert.deepEqual(await readSources(),expectedSources(4500,900,true));
   await db.exec('rollback to savepoint with_reversal');
   const spent=await db.query(`select public.create_internal_transfer($1,$2,$3,'2026-03-10',1200,1200,'SAR') as movement`,
    [owner,bank,home]);
   assert.equal(Number(spent.rows[0].movement.transferred_cost_base),1200);
   const balances=await db.query(`select asset_account_id,sum(remaining_value_base)::int as balance
    from lots where asset_account_id in ($1,$2) group by asset_account_id order by asset_account_id`,[bank,home]);
   assert.deepEqual(balances.rows,[{asset_account_id:bank,balance:4200},{asset_account_id:home,balance:1200}]);
   const afterSpending=await db.query("select public.personal_sale_preflight($1)->>'amount_block' as blocker",[sale.sale_transaction_id]);
   assert.equal(afterSpending.rows[0].blocker,'SALE_CORRECTION_PROCEEDS_USED');
   await db.exec('set local role authenticated');
   await db.query("select set_config('test.user',$1,true)",[otherUser]);
   assert.deepEqual((await db.query("select lot_id from public.zakat_lot_hawl_periods('GREGORIAN')")).rows,[]);
   assert.deepEqual((await db.query('select id from lots where user_id=$1',[owner])).rows,[]);
   if(captureSources)assert.deepEqual(await readSources(),[]);
   await db.exec('rollback');
   if(captureSources)console.log(`${path}, continuity ${continuity}: SAR 5,000 + 1,000 by source; corrected to SAR 4,500 + 900; one receipt, correct reversal status and owner-only read.`);
   else console.log(`${path}: 12 g sold, SAR 3,800 cost / 6,000 receipt / 2,200 gain, 8 g left; SAR 6,000 excluded from the lot-period candidates (missing hawl). One corrected receipt of SAR 5,400; SAR 4,200 remains after transferring SAR 1,200. Final and spent-proceeds guards verified.`);
  }
 }finally{
  await db.close();
 }
}

main().catch(error=>{console.error(error.message,error.detail??'');process.exitCode=1;});
