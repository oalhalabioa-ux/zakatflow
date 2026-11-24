const {PGlite}=require('@electric-sql/pglite');
const {readFileSync}=require('node:fs');
const assert=require('node:assert/strict');
(async()=>{
  const [schema,planner,writer]=process.argv.slice(2);
  const db=new PGlite();
  const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
  const u=id(1), accounts=[id(2),id(3)], sale=id(4), lots=[id(5),id(6)];
  await db.exec(`create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql as $$select '${u}'::uuid$$;create role anon;create role authenticated;`);
  const ddl=readFileSync(schema,'utf8').split('create table if not exists audit_logs')[0];
  await db.exec(ddl.replace('create extension if not exists pgcrypto;',''));
  await db.exec(readFileSync(schema,'utf8').match(/create table if not exists audit_logs[^;]+;/)[0]);
  await db.exec(`alter table transactions add organization_id uuid; alter table asset_accounts add organization_id uuid,add ownership_scope text default 'PERSONAL';insert into auth.users values('${u}');insert into profiles(id) values('${u}');insert into currencies(code,name_ar,name_en) values('SAR','SAR','SAR');`);
  await db.exec(readFileSync(planner,'utf8')+readFileSync(writer,'utf8'));
  for(const [i,a] of accounts.entries()){
    const t=id(10+i),q=i?6:4,c=i?2040:1200;
    await db.exec(`insert into asset_accounts(id,user_id,asset_type,name,currency) values('${a}','${u}','GOLD','test','SAR');
      insert into transactions(id,user_id,asset_account_id,transaction_type,transaction_date,currency,base_currency) values('${t}','${u}','${a}','PURCHASE','2026-01-01','SAR','SAR');
      insert into lots(id,user_id,asset_account_id,source_transaction_id,acquisition_date,hawl_start_date,hawl_due_date,original_quantity,remaining_quantity,original_value_base,remaining_value_base)
      values('${lots[i]}','${u}','${a}','${t}','2026-0${i+1}-01','2026-01-01','2027-01-01',${q},${q},${c},${c})`);
  }
  await db.exec(`insert into transactions(id,user_id,asset_account_id,transaction_type,transaction_date,quantity,currency,base_currency,base_value) values('${sale}','${u}','${accounts[0]}','SALE','2026-03-01',6,'SAR','SAR',2400)`);
  const apply=(method,selection)=>db.query('select public.apply_personal_sale_lots($1,$2::uuid[],$3,$4)',[sale,'{'+accounts.join(',')+'}',method,JSON.stringify(selection)]);
  const snapshot=async()=> (await db.query('select remaining_quantity::int as q,remaining_value_base::int as cost from lots order by acquisition_date')).rows;
  for(const [method,picks,balance,gain] of [
    ['FIFO',[],[{q:0,cost:0},{q:4,cost:1360}],520],
    ['MANUAL',lots.map((id,i)=>({id,quantity:i?5:1})),[{q:3,cost:900},{q:1,cost:340}],400]
  ]){
    await db.exec('begin');
    await apply(method,picks);
    if(method==='MANUAL') await db.exec('commit');
    assert.deepEqual(await snapshot(),balance);
    const record=(await db.query('select metadata from transactions where id=$1',[sale])).rows[0].metadata.lot_selection;
    assert.equal(record.realized_gain_base,gain);
    assert.equal(record.method,method);
    assert.deepEqual(record.allocations.map(a=>a.asset_account_id),accounts);
    assert.equal((await db.query('select count(*)::int n from audit_logs')).rows[0].n,1);
    assert.equal((await db.query('select count(*)::int n from transaction_allocations')).rows[0].n,2);
    await assert.rejects(apply(method,picks),/SALE_ALREADY_ALLOCATED/);
    if(method==='FIFO') await db.exec('rollback');
  }
  console.log('Passed both persisted allocation scenarios, audit, committed manual read-back, repeated invocation and FIFO rollback.');
  await db.close();
})().catch(e=>{console.error(e);process.exitCode=1});
