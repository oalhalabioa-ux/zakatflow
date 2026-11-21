// Uses only clean local CI infrastructure and synthetic records.
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {createClient} from '@supabase/supabase-js';
import {createServerClient} from '@supabase/ssr';

const root=process.env.ASSET_QA_ROOT;
assert.ok(root && process.env.RUNNER_TEMP && root.startsWith(process.env.RUNNER_TEMP+'/'));
const settings=JSON.parse(execFileSync('npx',['--yes','supabase@2.122.0','status','--workdir',root,'--output','json'],
 {encoding:'utf8',stdio:['ignore','pipe','pipe']}));
assert.equal(settings.API_URL,'http://127.0.0.1:54321');
const app='http://localhost:3000';
const admin=createClient(settings.API_URL,settings.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const {chromium}=await import(process.env.ASSET_BROWSER_MODULE);
const value=result=>{if(result.error)throw Error(result.error.message);return result.data;};

async function user(){
 const email=randomUUID()+'@asset-statement.invalid',password=randomUUID();
 const {user}=value(await admin.auth.admin.createUser({email,password,email_confirm:true}));
 const cookies=new Map();
 const client=createServerClient(settings.API_URL,settings.ANON_KEY,{cookies:{
  getAll:()=>[...cookies.values()],
  setAll:entries=>entries.forEach(cookie=>cookies.set(cookie.name,cookie)),
 }});
 value(await client.auth.signInWithPassword({email,password}));
 return {id:user.id,cookies:[...cookies.values()],client};
}

async function seed(owner,organization_id=null,manualGold=false){
 const src=organization_id?admin:owner.client;
 const {id}=value(await src.from('asset_accounts').insert({
  user_id:owner.id,name:organization_id?'QA Equipment Register':manualGold?'QA 18K Gold':'QA Gold Statement',
  metadata:manualGold?{karat:18,market_price_per_unit:410,market_price_currency:'SAR',market_value_auto:true,
   market_price_source:'USER_MANUAL',market_valuation_date:'2025-07-01'}:{},
  asset_type:organization_id?'OTHER':'GOLD',unit:organization_id?'unit':'g',currency:'SAR',
  ownership_scope:organization_id?'ORGANIZATION':'PERSONAL',organization_id,
 }).select('id').single());
 const entries=organization_id?[['2025-01-01',10,90000]]:manualGold?[['2025-01-01',10,3000]]:[['2025-01-01',5,1500],['2025-02-01',7,2240]];
 for(const [date,quantity,cost] of entries){
  const tx=value(await src.from('transactions').insert({
   user_id:owner.id,asset_account_id:id,organization_id,transaction_type:'OPENING_BALANCE',transaction_date:date,
   quantity,currency:'SAR',base_currency:'SAR',base_value:cost,gross_value:cost,created_by:owner.id,
  }).select('id').single());
  value(await src.from('lots').insert({user_id:owner.id,asset_account_id:id,source_transaction_id:tx.id,acquisition_date:date,
   original_quantity:quantity,remaining_quantity:quantity,original_value_base:cost,remaining_value_base:cost}));
 }
 if(organization_id)return id;
 const bank=value(await owner.client.from('asset_accounts').insert({user_id:owner.id,asset_type:'BANK',
  name:'QA Gold Proceeds',currency:'SAR',ownership_scope:'PERSONAL'}).select('id').single());
 const sale=value(await owner.client.rpc('post_sale_with_proceeds',{
  p_user_id:owner.id,p_asset_account_id:id,p_destination_account_id:bank.id,p_date:'2025-03-01',
  p_quantity:manualGold?2:3,p_sale_value:manualGold?800:1200,p_currency:'SAR',p_base_currency:'SAR',p_base_value:manualGold?800:1200,
 }));
 if(manualGold)return id;
 value(await owner.client.rpc('post_sale_with_proceeds',{
  p_user_id:owner.id,p_asset_account_id:id,p_destination_account_id:bank.id,p_date:'2025-04-01',
  p_quantity:3,p_sale_value:1650,p_currency:'SAR',p_base_currency:'SAR',p_base_value:1650,
 }));
 value(await owner.client.rpc('amend_personal_sale_price',{
  p_sale_id:sale.sale_transaction_id,p_request_id:randomUUID(),p_expected_revision:0,
  p_unit_price:440,p_reason:'Asset statement reviewed price correction',
 }));
 return id;
}

async function context(browser,account,viewport){
 const ctx=await browser.newContext({viewport});
 await ctx.addCookies(account.cookies.map(({name,value})=>({name,value,url:app})));
 await ctx.addInitScript(()=>localStorage.setItem('zf-theme','yaqeen-business'));
 return ctx;
}
function today(){
 return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
}

let server,browser;
try{
 const owner=await user(),stranger=await user();
 const {id:organization}=value(await owner.client.from('organizations').insert({name:'QA Assets Company',owner_user_id:owner.id}).select('id').single());
 const asset=await seed(owner),companyAsset=await seed(owner,organization),gold18=await seed(owner,null,true);
 server=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','-H','127.0.0.1','-p','3000'],{
  env:{...process.env,NEXT_PUBLIC_SUPABASE_URL:settings.API_URL,NEXT_PUBLIC_SUPABASE_ANON_KEY:settings.ANON_KEY,
   NEXT_PUBLIC_APP_URL:app,NEXT_PUBLIC_APP_ENV:'test',NEXT_PUBLIC_ASSET_LOT_QA:'1',SUPABASE_SERVICE_ROLE_KEY:'',RESEND_API_KEY:''},stdio:'inherit',
 });
 let ready=false;
 for(let i=0;i<120;i++){
  try{if((await fetch(app+'/ar/login',{signal:AbortSignal.timeout(2000)})).ok){ready=true;break;}}catch{}
  await delay(500);
 }
 assert.ok(ready);
 browser=await chromium.launch({headless:true});
 await mkdir('asset-qa-preview',{recursive:true});
 const ar=await context(browser,owner,{width:390,height:844});
 const en=await context(browser,owner,{width:1440,height:960});
 const foreign=await context(browser,stranger,{width:390,height:844});
 async function statement(ctx,id,date=today(),offset=0,limit=30){
  const response=await ctx.request.get(app+'/api/assets/'+id+'/statement?'+new URLSearchParams({asOf:date,offset:String(offset),limit:String(limit)}));
  const payload=await response.json();
  return {status:response.status(),payload};
 }
 const initial=await statement(en,asset,'2025-03-01',1,2);
 assert.equal(initial.status,200,JSON.stringify(initial.payload));
 assert.deepEqual(initial.payload.closing,{quantity:'9',cost:'2840',currency:'SAR'});
 assert.equal(initial.payload.rows.at(-1).amount,'1320');
 assert.equal(initial.payload.rows.at(-1).costEffect,'-900');
 const latest=await statement(en,asset);
 assert.equal(latest.status,200,JSON.stringify(latest.payload));
 assert.equal(latest.payload.reconciliation,'MATCHED');
 assert.deepEqual(latest.payload.closing,{quantity:'6',cost:'1920',currency:'SAR'});
 assert.ok(latest.payload.rows.find(row=>row.type==='PRICE_CORRECTION'));
 assert.ok(latest.payload.rows.filter(row=>row.type==='SALE').every(row=>row.voucher));
 const gold=await statement(en,gold18);
 assert.equal(gold.status,200,JSON.stringify(gold.payload));
 assert.deepEqual(gold.payload.closing,{quantity:'8',cost:'2400',currency:'SAR'});
 assert.equal(gold.payload.valuation.appliedPrice,'307.5');
 assert.equal(gold.payload.valuation.value,'2460');
 assert.equal(gold.payload.valuation.unrealized,'60');
 assert.deepEqual(gold.payload.rows[1].sale,{proceeds:'800',cost:'600',realized:'200'});
 const company=await statement(en,companyAsset);
 assert.equal(company.status,200,JSON.stringify(company.payload));
 assert.deepEqual(company.payload.closing,{quantity:'10',cost:'90000',currency:'SAR'});
 assert.equal((await statement(foreign,asset)).status,404);
 assert.equal((await statement(foreign,companyAsset)).status,404);

 for(const [locale,ctx,label,summary] of [
  ['ar',ar,'التفاصيل والإجراءات','كشف حركة الأصل'],
  ['en',en,'Details and actions','Asset movement statement'],
 ]){
  const page=await ctx.newPage();
  await page.goto(app+'/'+locale+'/assets?scope=PERSONAL',{waitUntil:'domcontentloaded',timeout:90000});
  await page.getByRole('row').filter({hasText:'QA 18K Gold'}).getByRole('button',{name:label,exact:true}).click({timeout:20000});
  const dialog=page.getByRole('dialog');
  await dialog.getByText(summary,{exact:true}).click();
  const table=dialog.getByRole('table');
  await table.getByText('2400',{exact:true}).first().waitFor({timeout:20000});
  assert.equal(await page.getByRole('dialog').count(),1);
  assert.equal(new URL(page.url()).pathname,'/'+locale+'/assets');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1));
  await dialog.getByText('2,460 SAR',{exact:true}).waitFor({timeout:20000});
  await dialog.getByText('307.5 SAR',{exact:true}).waitFor({timeout:20000});
  await dialog.locator('[data-asset-movement="OPENING_BALANCE"] > summary').click();
  await dialog.getByText(new RegExp('10 .* × 300 = 3,000 SAR')).waitFor({timeout:20000});
  await dialog.locator('[data-asset-movement="SALE"] > summary').click();
  await dialog.getByText(new RegExp('2 .* × 400 = 800 SAR')).waitFor({timeout:20000});
  await dialog.getByText('200 SAR',{exact:true}).waitFor({timeout:20000});
  await page.screenshot({path:`asset-qa-preview/statement-${locale}.png`});
 }
 for(const locale of ['ar','en']){
  const account=await user(), arabic=locale==='ar';
  const ctx=await context(browser,account,arabic?{width:390,height:844}:{width:1440,height:960});
  const sources=[];
  for(const [name,quantity,cost,date] of [['Alpha',4,1200,'2025-01-01'],['Beta',6,2040,'2025-02-01']]){
   const asset=value(await account.client.from('asset_accounts').insert({user_id:account.id,name,asset_type:'GOLD',currency:'SAR',unit:'g',ownership_scope:'PERSONAL',metadata:{karat:18}}).select('id').single());
   const tx=value(await account.client.from('transactions').insert({user_id:account.id,asset_account_id:asset.id,transaction_type:'OPENING_BALANCE',transaction_date:date,quantity,currency:'SAR',base_currency:'SAR',base_value:cost,gross_value:cost,created_by:account.id}).select('id').single());
   value(await account.client.from('lots').insert({user_id:account.id,asset_account_id:asset.id,source_transaction_id:tx.id,acquisition_date:date,original_quantity:quantity,remaining_quantity:quantity,original_value_base:cost,remaining_value_base:cost}));
   sources.push(asset.id);
  }
  const bank=value(await account.client.from('asset_accounts').insert({user_id:account.id,name:'QA Bank',asset_type:'BANK',currency:'SAR',ownership_scope:'PERSONAL'}).select('id').single());
  const page=await ctx.newPage();
  const open=async()=>{
   await page.getByRole('row').filter({hasText:arabic?'Alpha':'Beta'}).getByRole('button',{name:arabic?'التفاصيل والإجراءات':'Details and actions',exact:true}).click();
   await page.getByText(arabic?'كشف حركة الأصل':'Asset movement statement',{exact:true}).click();
  };
  await page.goto(app+'/'+locale+'/assets?scope=PERSONAL');
  await open();
  await page.getByRole('button',{name:arabic?'بيع من حزم الذهب':'Sell from gold lots'}).click();
  await page.getByLabel(arabic?'الكمية بالغرام':'Quantity in grams').fill('6');
  await page.getByLabel(arabic?'سعر بيع الغرام':'Sale price per gram').fill('400');
  if(arabic){
   await page.getByLabel('اختيار الحزم').selectOption('MANUAL');
   await page.getByLabel(/Alpha/).fill('1');
   await page.getByLabel(/Beta/).fill('5');
  }
  await page.getByRole('button',{name:arabic?'معاينة البيع':'Preview sale'}).click();
  await page.getByText(arabic?'الربح أو الخسارة المحققة 400 SAR':'Realized gain or loss 520 SAR').waitFor();
  const posted=page.waitForResponse(r=>r.url().includes('/rpc/gold_card_sale')&&r.request().postDataJSON()?.p_payload?.expected);
  await page.getByRole('button',{name:arabic?'حفظ سند البيع':'Save sale voucher'}).click();
  const response=await posted;assert.ok(response.ok(),await response.text());
  const sale=await response.json();
  await page.getByRole('button',{name:arabic?'بيع من حزم الذهب':'Sell from gold lots'}).waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({state:'hidden'});
  await open();
  await page.reload();
  await open();
  const docs=value(await account.client.from('voucher_numbers').select('source_id,document_number').in('source_id',[sale.sale_transaction_id,sale.proceeds_transaction_id]));
  assert.equal(docs.length,2);
  const number=docs.find(d=>d.source_id===sale.sale_transaction_id).document_number;
  await page.getByRole('dialog').getByText(number,{exact:true}).first().waitFor();
  for(const [i,id] of sources.entries()){
   const current=(await statement(ctx,id)).payload;
   assert.equal(current.reconciliation,'MATCHED');
   assert.equal(current.rows.find(r=>r.voucher===number).sale.realized,String((arabic?[100,300]:[400,120])[i]));
  }
  assert.equal(value(await account.client.from('lots').select('remaining_quantity').eq('asset_account_id',bank.id)).length,1);
  await page.screenshot({path:'asset-qa-preview/grouped-'+locale+'.png'});
  console.log('GROUPED_VOUCHERS',locale,JSON.stringify(docs));
  const balances=async()=>value(await account.client.from('lots').select('id,asset_account_id,remaining_quantity,remaining_value_base').eq('user_id',account.id).order('id'));
  const allocations=async()=>value(await account.client.from('transaction_allocations').select('lot_id,quantity,value_base,allocation_method').eq('transaction_id',sale.sale_transaction_id).order('lot_id'));
  const registry=await (await ctx.request.get(app+'/api/assets')).json();
  const perAsset=sources.map(id=>registry.find(item=>item.id===id));
  assert.deepEqual(perAsset.map(item=>item.sold_cost_value),arabic?[300,1700]:[1200,680]);
  assert.equal(perAsset.reduce((total,item)=>total+item.sold_proceeds_value,0),2400);
  assert.equal(perAsset.reduce((total,item)=>total+item.current_cost_value,0),arabic?1240:1360);
  const original=await allocations();
  const amend=(revision,price,key)=>account.client.rpc('amend_personal_sale_price',{p_sale_id:sale.sale_transaction_id,p_request_id:key,p_expected_revision:revision,p_unit_price:price,p_reason:'QA grouped sale amendment'});
  for(const [rev,price] of [[0,390],[1,400]]){
   const detail=page.locator('[data-asset-movement="SALE"]').filter({hasText:number});
   await detail.locator('summary').click();
   await detail.getByRole('button',{name:arabic?'تصحيح سعر السند':'Correct sale price'}).click();
   await detail.getByLabel(arabic?'سعر البيع المصحح':'Corrected sale price').fill(String(price));
   await detail.getByLabel(arabic?'سبب الإجراء':'Reason for change').fill('QA grouped sale amendment');
   const corrected=page.waitForResponse(r=>r.url().includes('/rpc/amend_personal_sale_price'));
   const refreshed=page.waitForResponse(r=>r.url().includes('/statement?'));
   await detail.getByRole('button',{name:arabic?'حفظ التصحيح':'Save correction'}).click();
   const confirmation=await corrected;
   assert.ok(confirmation.ok(),await confirmation.text());
   const key=confirmation.request().postDataJSON().p_request_id;
   const accepted=await confirmation.json();
   await refreshed;
   assert.deepEqual(value(await amend(rev,price,key)),accepted);
   assert.deepEqual(await allocations(),original);
   assert.equal(Number((await balances()).find(l=>l.asset_account_id===bank.id).remaining_quantity),6*price);
  }
  const prior=await balances();
  const reversal=await account.client.rpc('reverse_transaction',{p_user_id:account.id,p_transaction_id:sale.sale_transaction_id});
  assert.match(reversal.error?.message??'',/GROUPED_SALE_REVERSAL_UNAVAILABLE/);
  assert.deepEqual(await balances(),prior);
  const card=(payload)=>account.client.rpc('gold_card_sale',{p_asset:sources[0],p_date:today(),p_payload:payload});
  const params={quantity:'2',price:'380',method:'FIFO',bank:bank.id,selection:[]};
  const pre=value(await card(params));
  const attempts=await Promise.all([randomUUID(),randomUUID()].map(request=>card({...params,request,expected:pre.allocations})));
  assert.equal(attempts.filter(r=>!r.error).length,1);
  assert.match(attempts.find(r=>r.error).error.message,/SALE_PREVIEW_CHANGED|SALE_LOTS_UNAVAILABLE/);
  const all=await balances();
  assert.ok(all.every(l=>Number(l.remaining_quantity)>=0));
  assert.equal(all.filter(l=>l.asset_account_id===bank.id).reduce((a,l)=>a+Number(l.remaining_quantity),0),3160);
  const latestSale=attempts.find(r=>!r.error).data.sale_transaction_id;
  const reverse=(id,key,revision)=>account.client.rpc('reverse_grouped_gold_sale',{p_sale:id,p_request:key,p_revision:revision,p_reason:'QA paired sale reversal'});
  const rejected=await reverse(sale.sale_transaction_id,randomUUID(),2);
  assert.equal(rejected.error?.message,'SALE_CORRECTION_LATER_MOVEMENTS');
  assert.equal(rejected.error?.details,latestSale);
  assert.deepEqual(await balances(),all);
  const reverseKey=randomUUID();
  const accepted=value(await reverse(latestSale,reverseKey,0));
  assert.deepEqual(value(await reverse(latestSale,reverseKey,0)),accepted);
  assert.deepEqual(await allocations(),original);
  const final=await balances();
  assert.equal(final.filter(l=>l.asset_account_id===bank.id).reduce((a,l)=>a+Number(l.remaining_quantity),0),2400);
  await page.reload();
  await open();
  const originalDetail=page.locator('[data-asset-movement="SALE"]').filter({hasText:number});
  await originalDetail.locator('summary').click();
  await originalDetail.getByRole('button',{name:arabic?'عكس البيع والقبض':'Reverse sale and receipt'}).click();
  await originalDetail.getByLabel(arabic?'سبب الإجراء':'Reason for change').fill('QA paired sale reversal');
  const reversalResponse=page.waitForResponse(r=>r.url().includes('/rpc/reverse_grouped_gold_sale'));
  await originalDetail.getByRole('button',{name:arabic?'تأكيد عكس البيع والقبض':'Confirm sale and receipt reversal'}).click();
  const reversed=await reversalResponse;
  assert.ok(reversed.ok(),await reversed.text());
  for(const [i,id] of sources.entries()){
   const current=(await statement(ctx,id)).payload;
   assert.equal(current.reconciliation,'MATCHED');
   assert.equal(current.closing.cost,String([1200,2040][i]));
  }
  console.log('GROUPED_REVERSAL',locale,JSON.stringify(accepted));
  await ctx.close();
 }
 console.log('PASS scoped opening and FIFO statement; 9 units / 2840 as of first sale, 6 / 1920 today, corporate 10 / 90000, denied cross-user and organization, AR mobile and EN desktop');
}finally{
 await browser?.close();
 server?.kill();
}
