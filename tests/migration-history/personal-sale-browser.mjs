// Real browser, auth and database against the disposable canonical-history environment.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {execFileSync,spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {createClient} from '@supabase/supabase-js';
import {createServerClient} from '@supabase/ssr';
import {verifyInvoiceTerms} from './personal-invoice-terms-browser.mjs';

const root = process.env.HISTORY_QA_WORKDIR;
assert.ok(root && process.env.RUNNER_TEMP && root.startsWith(process.env.RUNNER_TEMP+'/'));
const status = JSON.parse(execFileSync('npx',['--yes','supabase@2.122.0','status','--workdir',root,'--output','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
assert.equal(status.API_URL,'http://127.0.0.1:54321');
// Match the local origin reconstructed by Next for route handlers.
const app = 'http://localhost:3000';
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

async function seed(client,owner,withHawl=false){
  const accounts = value(await client.from('asset_accounts').insert([
    {user_id:owner.id,asset_type:'GOLD',name:'QA original gold',currency:'SAR',unit:'g',is_zakatable:withHawl,metadata:{karat:24},ownership_scope:'PERSONAL'},
    {user_id:owner.id,asset_type:'GOLD',name:'QA correct gold',currency:'SAR',unit:'g',is_zakatable:withHawl,metadata:{karat:24},ownership_scope:'PERSONAL'},
    {user_id:owner.id,asset_type:'BANK',name:'QA bank',currency:'SAR',unit:'SAR',is_zakatable:withHawl,metadata:{},ownership_scope:'PERSONAL'},
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
    hawl_start_date:withHawl?'2025-01-01':null,
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
      NEXT_PUBLIC_PERSONAL_INCOME:'true',NEXT_PUBLIC_APP_URL:app,NEXT_PUBLIC_APP_ENV:'test',NEXT_TELEMETRY_DISABLED:'1',SUPABASE_SERVICE_ROLE_KEY:'',RESEND_API_KEY:''},
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
  await saleRow.getByRole('button',{name:'مراجعة تصحيح البيع',exact:true}).waitFor();
  assert.equal(await filters.locator('.yq-filter-native:visible').count(),0);
  assert.equal(await filters.locator('.yq-filter-trigger:visible').count(),3);
  await saleRow.getByRole('button',{name:'مراجعة تصحيح البيع',exact:true}).click();
  const dialog=page.getByRole('dialog');
  await dialog.getByLabel('نوع التصحيح').selectOption('structure');
  const asset=dialog.getByLabel('الأصل المباع');
  await asset.locator(`option[value="${fixture.newAsset}"]`).waitFor({state:'attached'});
  assert.equal(await asset.inputValue(),fixture.oldAsset);
  assert.equal(await dialog.getByLabel('الكمية',{exact:true}).inputValue(),'2');
  await asset.selectOption(fixture.newAsset);
  await dialog.getByLabel('الكمية',{exact:true}).fill('3');
  await dialog.getByLabel('سعر الوحدة').fill('30');
  await dialog.getByLabel('سبب التصحيح').fill('تصحيح الأصل وسعر البيع');
  await dialog.locator('output').waitFor();
  const correctedResponse=page.waitForResponse(r=>r.request().method()==='POST' && r.request().postDataJSON()?.action==='correct-sale' && r.url().endsWith('/api/transactions/'+fixture.sale.sale_transaction_id));
  await dialog.getByRole('button',{name:'حفظ التصحيح',exact:true}).click();
  const posted=await correctedResponse;
  const corrected=await posted.json();
  assert.equal(posted.status(),201,JSON.stringify(corrected));
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

  const preserveOwner=await signedIn();
  const preserve=await seed(preserveOwner.client,preserveOwner.user,true);
  const subsequent=value(await preserveOwner.client.rpc('post_sale_with_proceeds',{
    p_user_id:preserveOwner.user.id,p_asset_account_id:preserve.newAsset,p_destination_account_id:preserve.bank,
    p_date:'2025-02-02',p_quantity:7,p_sale_value:200,p_currency:'SAR',p_base_currency:'SAR',p_base_value:200,
  }));
  const laterIds=[subsequent.sale_transaction_id,subsequent.proceeds_transaction_id];
  const laterEvidence=async()=>{
    const [documents, numbers, allocation, hawl]=await Promise.all([
      preserveOwner.client.from('transactions').select('*').in('id',laterIds).order('id'),
      preserveOwner.client.from('voucher_numbers').select('*').in('source_id',laterIds).order('source_id'),
      preserveOwner.client.from('transaction_allocations').select('*').eq('transaction_id',subsequent.sale_transaction_id),
      preserveOwner.client.rpc('gold_receipt_assessment_periods',{p_receipt:subsequent.proceeds_transaction_id,p_calendar:'HIJRI'}),
    ]);
    return {documents:value(documents),numbers:value(numbers),allocation:value(allocation),hawl:value(hawl)};
  };
  const laterBefore=await laterEvidence();
  assert.equal(laterBefore.numbers.length,2);
  assert.equal(laterBefore.hawl.length,1);
  const preserveContext=await openContext(browser,preserveOwner.cookies,{width:390,height:844});
  const preservePage=await preserveContext.newPage();
  await preservePage.goto(app+'/ar/transactions/'+preserve.sale.sale_transaction_id,{waitUntil:'domcontentloaded'});
  await preservePage.getByRole('button',{name:'مراجعة تصحيح البيع',exact:true}).click();
  await preservePage.getByLabel('نوع التصحيح').selectOption('asset');
  await preservePage.getByLabel('الأصل المباع').selectOption(preserve.newAsset);
  await preservePage.getByRole('status').filter({hasText:'يبقى تخصيص الدفعات'}).waitFor();
  assert.equal(await preservePage.getByLabel('سعر الوحدة').count(),0);
  await preservePage.getByLabel('سبب التصحيح').fill('اختيار الأصل الصحيح بنفس التاريخ');
  const savedAsset=preservePage.waitForResponse(r=>r.request().method()==='POST'&&r.request().postDataJSON()?.action==='correct-sale');
  await preservePage.getByRole('button',{name:'حفظ التصحيح',exact:true}).click();
  const savedAssetResponse=await savedAsset;
  const savedAssetResult=await savedAssetResponse.json();
  assert.equal(savedAssetResponse.status(),201,JSON.stringify(savedAssetResult));
  assert.equal(savedAssetResponse.request().postDataJSON().transaction_date,'2025-02-01');
  await preservePage.goto(app+'/en/transactions/'+savedAssetResult.id,{waitUntil:'domcontentloaded'});
  await preservePage.reload({waitUntil:'domcontentloaded'});
  await preservePage.getByText('QA correct gold',{exact:true}).waitFor();
  assert.deepEqual(await laterEvidence(),laterBefore);
  await preserveContext.close();

  const historical=await seed(other.client,other.user);
  const later=value(await other.client.rpc('post_sale_with_proceeds',{
    p_user_id:other.user.id,p_asset_account_id:historical.oldAsset,p_destination_account_id:historical.bank,
    p_date:'2025-02-02',p_quantity:3,p_sale_value:90,p_currency:'SAR',p_base_currency:'SAR',p_base_value:90,
  }));
  async function quantities(){
    const assets=value(await other.client.from('lots').select('remaining_quantity,remaining_value_base').eq('asset_account_id',historical.oldAsset));
    const bank=value(await other.client.from('lots').select('remaining_value_base').eq('asset_account_id',historical.bank));
    return {units:assets.reduce((sum,row)=>sum+Number(row.remaining_quantity),0),
      cost:assets.reduce((sum,row)=>sum+Number(row.remaining_value_base),0),
      bank:bank.reduce((sum,row)=>sum+Number(row.remaining_value_base),0)};
  }
  async function allocations(){
    return value(await other.client.from('transaction_allocations').select('*')
      .in('transaction_id',[historical.sale.sale_transaction_id,later.sale_transaction_id]).order('id'));
  }
  const salePath='/api/transactions/'+historical.sale.sale_transaction_id;
  async function voucherIds(){
    return value(await other.client.from('transactions').select('id').eq('user_id',other.user.id).order('id'));
  }
  async function priceAudit(){
    return value(await other.client.from('audit_logs').select('old_data,new_data')
      .eq('entity_id',historical.sale.sale_transaction_id).eq('action','AMEND_PERSONAL_SALE_PRICE'))
      .sort((a,b)=>a.new_data.revision-b.new_data.revision);
  }
  const before=await quantities(),fifoBefore=await allocations(),vouchersBefore=await voucherIds();
  assert.equal(vouchersBefore.length,6);
  assert.deepEqual(before,{units:5,cost:50,bank:130});
  const historyContext=await openContext(browser,other.cookies,{width:390,height:844});
  const historyPage=await historyContext.newPage();
  historyPage.setDefaultTimeout(20000);
  await historyPage.goto(app+'/ar/transactions?scope=PERSONAL',{waitUntil:'domcontentloaded',timeout:90000});
  await historyPage.locator('.transaction-filters input').first().fill(historical.voucher);
  await historyPage.getByRole('row').filter({hasText:historical.voucher})
    .getByRole('button',{name:'مراجعة تصحيح البيع',exact:true}).click();
  const correction=historyPage.getByRole('dialog');
  const mode=correction.getByLabel('نوع التصحيح');
  await correction.getByRole('link',{name:/2025-02-02/}).waitFor();
  assert.equal(await mode.inputValue(),'price');
  await mode.selectOption('structure');
  await correction.getByText(/توجد حركة مرتبطة بتاريخ البيع/).waitFor();
  assert.equal(await correction.getByRole('button',{name:'حفظ التصحيح',exact:true}).count(),0);
  await mode.selectOption('price');
  async function savePrice(form,price,labels,expectedRevision){
    await form.getByLabel(labels.price).fill(String(price));
    await form.getByLabel(labels.reason).fill(labels.reasonText);
    const response=historyPage.waitForResponse(r=>r.request().method()==='POST'&&
      new URL(r.url()).pathname===salePath&&r.request().postDataJSON()?.action==='amend-sale-price');
    await form.getByRole('button',{name:labels.save,exact:true}).click();
    const saved=await response;
    const result=await saved.json();
    assert.equal(saved.status(),201,JSON.stringify(result));
    assert.equal(result.id,historical.sale.sale_transaction_id);
    assert.equal(result.receipt_id,historical.sale.proceeds_transaction_id);
    assert.equal(result.revision,expectedRevision+1);
    const payload=saved.request().postDataJSON();
    assert.equal(payload.expected_revision,expectedRevision);
    return {payload,result};
  }
  async function replay(payload){
    return historyPage.evaluate(async ({path,payload})=>{
      const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      return {status:response.status,body:await response.json()};
    },{path:salePath,payload});
  }
  const first=await savePrice(correction,15,{price:'سعر الوحدة',reason:'سبب التصحيح',
    reasonText:'تخفيض سعر بيع تاريخي',save:'حفظ التصحيح'},0);
  await correction.getByText('تم تصحيح السعر والقبض المرتبط').waitFor();
  assert.deepEqual(await replay(first.payload),{status:201,body:first.result});

  const originalVoucher=app+'/en/transactions/'+historical.sale.sale_transaction_id;
  await historyPage.goto(originalVoucher,{waitUntil:'domcontentloaded'});
  const reviewPrice=historyPage.getByRole('button',{name:'Review sale correction',exact:true});
  await reviewPrice.waitFor();
  await historyPage.reload({waitUntil:'domcontentloaded'});
  await reviewPrice.click();
  assert.equal(await historyPage.getByLabel('Unit price').inputValue(),'15');
  const afterDecrease=await quantities();
  assert.deepEqual(afterDecrease,{units:5,cost:50,bank:120});
  assert.deepEqual(await allocations(),fifoBefore);
  assert.deepEqual(await voucherIds(),vouchersBefore);
  assert.deepEqual((await priceAudit()).map(a=>[a.old_data.sale_amount,a.new_data.sale_amount]),[[40,30]]);

  const second=await savePrice(historyPage,18,{price:'Unit price',reason:'Correction reason',
    reasonText:'Second correction after reopening the voucher',save:'Save correction'},1);
  assert.deepEqual(await replay(second.payload),{status:201,body:second.result});
  assert.deepEqual(await replay(first.payload),{status:409,body:{error:'SALE_CORRECTION_STALE'}});
  await historyPage.reload({waitUntil:'domcontentloaded'});
  await reviewPrice.click();
  assert.equal(await historyPage.getByLabel('Unit price').inputValue(),'18');

  const afterSecond=await quantities();
  assert.deepEqual(afterSecond,{units:5,cost:50,bank:126});
  assert.deepEqual(await allocations(),fifoBefore);
  assert.deepEqual(await voucherIds(),vouchersBefore);
  const savedSale=value(await other.client.from('transactions').select('quantity,gross_value').eq('id',historical.sale.sale_transaction_id).single());
  assert.equal(Number(savedSale.gross_value),36);
  assert.equal(Number(savedSale.quantity),2);
  const receipt=value(await other.client.from('transactions').select('gross_value').eq('id',historical.sale.proceeds_transaction_id).single());
  assert.equal(Number(receipt.gross_value),36);
  const history=await priceAudit();
  assert.deepEqual(history.map(a=>[a.old_data.sale_amount,a.new_data.sale_amount]),[[40,30],[30,36]]);
  assert.equal(await historyPage.getByText('QA original gold',{exact:true}).count(),1);
  console.log('PASS historical browser price decrease and second edit after reload '+JSON.stringify({
    before,afterDecrease,afterSecond,vouchers:vouchersBefore.length,auditRows:history.length,
    fifoRows:fifoBefore.length,duplicateRetries:2,rejectedStaleRetries:1,
  }));
  await historyPage.goto(app+'/en/transactions?scope=PERSONAL',{waitUntil:'domcontentloaded'});
  const opening=historyPage.getByRole('row').filter({hasText:'QA correct gold'}).filter({hasText:'Opening balance'});
  await opening.getByRole('button',{name:'Edit notes',exact:true}).click();
  const noteDialog=historyPage.getByRole('dialog');
  const note='Verified descriptive note for the opening voucher';
  await noteDialog.locator('textarea').fill(note);
  await noteDialog.getByRole('button',{name:'Save notes',exact:true}).click();
  await noteDialog.getByText(note,{exact:true}).waitFor();
  await historyPage.reload({waitUntil:'domcontentloaded'});
  await opening.getByRole('button',{name:'Edit notes',exact:true}).click();
  await noteDialog.locator('textarea').waitFor();
  assert.equal(await noteDialog.locator('textarea').inputValue(),note);
  await historyContext.close();

  const foreign=await openContext(browser,other.cookies,{width:1440,height:960});
  const inaccessible=await foreign.request.get(app+'/api/transactions/'+corrected.id);
  assert.equal(inaccessible.status(),404);
  await verifyInvoiceTerms({app,owner,ownerContext:context,otherContext:foreign,value});
  await foreign.close();
  await context.close();
  console.log('PASS authenticated AR mobile sale correction, one filter per field, saved balances, reload and user isolation');
} finally {
  await browser?.close();
  if(server?.pid) server.kill();
}
