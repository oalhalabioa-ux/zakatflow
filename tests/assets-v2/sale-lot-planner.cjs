const {PGlite} = require('@electric-sql/pglite');
const {readFileSync} = require('node:fs');
const assert = require('node:assert/strict');
(async()=>{
  const db=new PGlite();
  await db.exec('create role anon; create role authenticated');
  await db.exec(readFileSync(process.argv[2],'utf8'));
  const jan='00000000-0000-4000-8000-000000000001';
  const feb='00000000-0000-4000-8000-000000000002';
  const lots=[{id:jan,remaining_quantity:4,remaining_value_base:1200},{id:feb,remaining_quantity:6,remaining_value_base:2040}];
  const plan=async(method,selection,quantity=6)=>(await db.query('select * from public.plan_asset_sale_lots($1,$2,$3,$4)',[JSON.stringify(lots),quantity,method,JSON.stringify(selection)])).rows;
  const pick=(id,quantity)=>({id,quantity});
  const fifo=await plan('FIFO',[]);
  const manual=await plan('MANUAL',[pick(feb,5),pick(jan,1)]);
  for(const [rows,expected] of [[fifo,[[4,1200,0,0],[2,680,4,1360]]],[manual,[[1,300,3,900],[5,1700,1,340]]]]) {
    assert.deepEqual(rows.map(r=>[r.allocated_quantity,r.cost_base,r.quantity_after,r.cost_after].map(Number)),expected);
  }
  for(const [mode,items] of [['MANUAL',[pick(feb,7)]],['MANUAL',[pick(jan,3),pick(jan,3)]],['MANUAL',[pick(feb,4)]],['MANUAL',[pick('00000000-0000-4000-8000-000000000003',6)]],['FIFO',[pick(feb,6)]]]) await assert.rejects(plan(mode,items));
  assert.equal((await plan('MANUAL',[pick(feb,6)]))[0].lot_id,feb);
  await db.exec('set role authenticated');
  await assert.rejects(plan('FIFO',[]),/permission denied/);
  console.log('9 PostgreSQL assertions passed');
  await db.close();
})().catch(e=>{console.error(e);process.exitCode=1});
