// Real browser, auth and database against the disposable canonical-history environment.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {execFileSync,spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {createClient} from '@supabase/supabase-js';
import {createServerClient} from '@supabase/ssr';

const root = process.env.HISTORY_QA_WORKDIR;
assert.ok(root && process.env.RUNNER_TEMP && root.startsWith(process.env.RUNNER_TEMP+'/'));
const status = JSON.parse(execFileSync('npx',['--yes','supabase@2.122.0','status','--workdir',root,'--output','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
assert.equal(status.API_URL,'http://127.0.0.1:54321');
const app = 'http://127.0.0.1:3000';
const admin = createClient(status.API_URL,status.SERVICE_ROLE_KEY,{
  auth:{autoRefreshToken:false,persistSession:false},
});
const {chromium} = await import(process.env.HISTORY_BROWSER_MODULE);

function value(result){
  if(result.error) throw Error(result.error.message);
  return result.data;
}

async function signedIn(){
  const email = `${randomUUID()}@sale-browser.invalid`;
  const password = randomUUID();
  const {user} = value(await admin.auth.admin.createUser({email,password,email_confirm:true}));
  const cookies = new Map();
  const client = createServerClient(status.API_URL,status.ANON_KEY,{
    cookies:{
      getAll:()=>[...cookies.values()],
      setAll:(entries)=>entries.forEach(cookie=>cookies.set(cookie.name,cookie)),
    },
  });
  value(await client.auth.signInWithPassword({email,password}));
  return {client,cookies:[...cookies.values()],user};
}

async function seed(client,owner){
  const accounts = value(await client.from('asset_accounts').insert([
    {user_id:owner.id,asset_type:'GOLD',name:'QA original gold',currency:'SAR',ownership_scope:'PERSONAL'},
    {user_id:owner.id,asset_type:'GOLD',name:'QA correct gold',currency:'SAR',ownership_scope:'PERSONAL'},
    {user_id:owner.id,asset_type:'BANK',name:'QA bank',currency:'SAR',ownership_scope:'PERSONAL'},
  ]).select('id,name'));
  const byName = Object.fromEntries(accounts.map(a=>[a.name,a.id]));
  const oldAsset=byName['QA original gold'], newAsset=byName['QA correct gold'], bank=byName['QA bank'];
  const openings = value(await client.from('transactions').insert([oldAsset,newAsset].map(asset_account_id=>({
    user_id:owner.id,asset_account_id,transaction_type:'OPENING_BALANCE',transaction_date:'2025-01-01',quantity:10,
    currency:'SAR',gross_value:100,base_currency:'SAR',base_value:100,created_by:owner.id,
  }))).select('id,asset_account_id'));
  value(await client.from('lots').insert(openings.map(tx=>({
    user_id:owner.id,asset_account_id:tx.asset_account_id,source_transaction_id:tx.id,acquisition_date:'2025-01-01',
    original_quantity:10,remaining_quantity:10,original_value_base:100,remaining_value_base:100,
  }))));
  const sale = value(await client.rpc('post_sale_with_proceeds',{
    p_user_id:owner.id,p_asset_account_id:oldAsset,p_destination_account_id:bank,p_date:'2025-02-01',
    p_quantity:2,p_sale_value:40,p_currency:'SAR',p_base_currency:'SAR',p_base_value:40,
  }));
  const voucher = value(await client.from('voucher_numbers').select('document_number')
    .eq('source_table','transactions').eq('source_id',sale.sale_transaction_id).single()).document_number;
  return {oldAsset,newAsset,bank,sale,voucher};
}

async function openContext(browser,cookies,viewport){
  const ctx = await browser.newContext({viewport});
  await ctx.addCookies(cookies.map(({name,value})=>({name,value,url:app})));
  await ctx.addInitScript(()=>localStorage.setItem('zf-theme','yaqeen-business'));
  return ctx;
}

let server, browser;
try {
  const owner=await signedIn();
  const other=await signedIn();
  const fixture=await seed(owner.client,owner.user);
  server=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','-H','127.0.0.1','-p','3000'],{
    env:{...process.env,NEXT_PUBLIC_SUPABASE_URL:status.API_URL,NEXT_PUBLIC_SUPABASE_ANON_KEY:status.ANON_KEY,
      NEXT_PUBLIC_APP_URL:app,NEXT_PUBLIC_APP_ENV:'test',NEXT_TELEMETRY_DISABLED:'1',SUPABASE_SERVICE_ROLE_KEY:'',RESEND_API_KEY:''},
    stdio:'inherit',
  });
  let ready=false;
  for(let i=0;i<120;i++){
    try {if((await fetch(app+'/ar/login',{signal:AbortSignal.timeout(2000)})).ok){ready=true;break;}} catch {}
    await delay(500);
  }
  assert.ok(ready,'Disposable Next server must start');
  browser=await chromium.launch({headless:true});
  const context=await openContext(browser,owner.cookies,{width:390,height:844});
  const page=await context.newPage();
  page.setDefaultTimeout(20000);
  await page.goto(app+'/ar/transactions?scope=PERSONAL',{waitUntil:'domcontentloaded',timeout:90000});
  const filters=page.locator('.transaction-filters');
  const search=filters.locator('input').first();
  await search.fill(fixture.voucher);
  const saleRow=page.getByRole('row').filter({hasText:fixture.voucher});
  await saleRow.getByRole('button',{name:'تصحيح سند البيع',exact:true}).waitFor();
  assert.equal(await filters.locator('.yq-filter-native:visible').count(),0);
  assert.equal(await filters.locator('.yq-filter-trigger:visible').count(),3);
  await saleRow.getByRole('button',{name:'تصحيح سند البيع',exact:true}).click();
  const dialog=page.getByRole('dialog');
  const asset=dialog.getByLabel('الأصل المباع');
  await asset.locator(`option[value="${fixture.newAsset}"]`).waitFor({state:'attached'});
  assert.equal(await asset.inputValue(),fixture.oldAsset);
  assert.equal(await dialog.getByLabel('الكمية',{exact:true}).inputValue(),'2');
  await asset.selectOption(fixture.newAsset);
  await dialog.getByLabel('الكمية',{exact:true}).fill('3');
  await dialog.getByLabel('سعر الوحدة').fill('30');
  await dialog.getByLabel('سبب التصحيح').fill('تصحيح الأصل وسعر البيع');
  await dialog.locator('output').waitFor();
  const correctedResponse=page.waitForResponse(r=>r.request().method()==='POST' && r.url().endsWith('/api/transactions/'+fixture.sale.sale_transaction_id));
  await dialog.getByRole('button',{name:'حفظ التصحيح',exact:true}).click();
  const posted=await correctedResponse;
  assert.equal(posted.status(),201,await posted.text());
  const corrected=await posted.json();
  await dialog.getByText('تم حفظ سند البيع المصحح وربطه بالسند الأصلي').waitFor();
  await dialog.getByRole('link',{name:/عرض سند البيع الأصلي/}).waitFor();

  const correctedTx=value(await owner.client.from('transactions').select('*').eq('id',corrected.id).single());
  assert.equal(correctedTx.asset_account_id,fixture.newAsset);
  assert.equal(Number(correctedTx.gross_value),90);
  assert.equal(correctedTx.metadata.corrects_sale_id,fixture.sale.sale_transaction_id);
  const cashLots=value(await owner.client.from('lots').select('remaining_quantity').eq('asset_account_id',fixture.bank));
  assert.equal(cashLots.reduce((sum,row)=>sum+Number(row.remaining_quantity),0),90);

  await page.goto(app+'/en/transactions/'+corrected.id,{waitUntil:'domcontentloaded',timeout:90000});
  await page.getByRole('link',{name:/View original sale voucher/}).waitFor();
  await page.getByText('QA correct gold',{exact:true}).waitFor();
  await page.reload({waitUntil:'domcontentloaded'});
  await page.getByRole('link',{name:/View original sale voucher/}).waitFor();

  const foreign=await openContext(browser,other.cookies,{width:1440,height:960});
  const inaccessible=await foreign.request.get(app+'/api/transactions/'+corrected.id);
  assert.equal(inaccessible.status(),404);
  await foreign.close();
  await context.close();
  console.log('PASS authenticated AR mobile sale correction, one filter per field, saved balances, reload and user isolation');
} finally {
  await browser?.close();
  if(server?.pid) server.kill();
}
