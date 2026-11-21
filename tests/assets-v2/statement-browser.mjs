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
   NEXT_PUBLIC_APP_URL:app,NEXT_PUBLIC_APP_ENV:'test',SUPABASE_SERVICE_ROLE_KEY:'',RESEND_API_KEY:''},stdio:'inherit',
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
  await dialog.locator('section details summary').filter({hasText:/SALE|Sale|بيع/}).click();
  await dialog.getByText('200 SAR',{exact:true}).waitFor({timeout:20000});
  await page.screenshot({path:`asset-qa-preview/statement-${locale}.png`});
 }
 console.log('PASS scoped opening and FIFO statement; 9 units / 2840 as of first sale, 6 / 1920 today, corporate 10 / 90000, denied cross-user and organization, AR mobile and EN desktop');
}finally{
 await browser?.close();
 server?.kill();
}
