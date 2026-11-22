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
  await db.exec(`alter table zakat_assessments add assessment_kind text;
    alter table lots alter hawl_start_date set default current_date,alter hawl_due_date set default current_date;
    update asset_accounts set unit='g',metadata='{"karat":18}';
    insert into asset_accounts(id,user_id,asset_type,name,currency) values('${id(9)}','${u}','BANK','test','SAR');`);
  await db.exec(readFileSync(process.argv[5],'utf8'));
  const post=(method,selection,price=400)=>db.query('select public.post_personal_gold_lot_sale($1,18,$2,$3,6,$4,$5,$6) as sale',
    [id(30),id(9),'2026-03-01',price,method,JSON.stringify(selection)]);
  for(const method of ['FIFO','MANUAL']){
    await db.exec('begin');
    const picks=method==='FIFO'?[]:lots.map((id,i)=>({id,quantity:i?5:1}));
    const first=(await post(method,picks)).rows[0].sale;
    assert.equal(first.realized_gain_base,method==='FIFO'?520:400);
    assert.deepEqual((await post(method,picks)).rows[0].sale,first);
    if(method==='MANUAL') await db.exec('commit');
    assert.deepEqual((await db.query("select transaction_type::text kind,count(*)::int n from transactions where transaction_type in ('SALE','ADD') group by 1 order by 1")).rows,[{kind:'ADD',n:1},{kind:'SALE',n:1}]);
    assert.equal((await db.query('select sum(remaining_quantity)::int amount from lots where asset_account_id=$1',[id(9)])).rows[0].amount,2400);
    assert.equal((await db.query('select count(*)::int n from audit_logs')).rows[0].n,1);
    assert.equal((await db.query('select sum(remaining_value_base)::int cost from lots where asset_account_id<>$1',[id(9)])).rows[0].cost,method==='FIFO'?1360:1240);
    if(method==='FIFO') await db.exec('rollback');
    else await assert.rejects(post(method,picks,410),/SALE_REQUEST_CONFLICT/);
  }
  console.log('FIFO and manual sale, receipt, lots, audit, retry and conflicting retry verified');
  await db.close();
})().catch(e=>{console.error(e);process.exitCode=1});
