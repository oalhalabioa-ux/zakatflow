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
 const email=randomUUID()+'@asset-edit.invalid',password=randomUUID();
 const {user}=value(await admin.auth.admin.createUser({email,password,email_confirm:true}));
 const cookies=new Map();
 const client=createServerClient(settings.API_URL,settings.ANON_KEY,{cookies:{
  getAll:()=>[...cookies.values()],
  setAll:entries=>entries.forEach(cookie=>cookies.set(cookie.name,cookie)),
 }});
 value(await client.auth.signInWithPassword({email,password}));
 return {id:user.id,cookies:[...cookies.values()],client};
}

async function context(browser,account,viewport){
 const ctx=await browser.newContext({viewport});
 await ctx.addCookies(account.cookies.map(({name,value})=>({name,value,url:app})));
 await ctx.addInitScript(()=>localStorage.setItem('zf-theme','yaqeen-business'));
 return ctx;
}
const before = process.env.ASSET_EDIT_PHASE === 'before';

async function seed(owner, name, metadata, {organization = null, history = false, type = 'GOLD'} = {}) {
 const asset = value(await admin.from('asset_accounts').insert({
  user_id: owner.id, name, asset_type: type, unit: type === 'GOLD' ? 'g' : 'unit', currency: 'SAR',
  ownership_scope: organization ? 'ORGANIZATION' : 'PERSONAL', organization_id: organization, metadata,
 }).select('*').single());
 if (!history) return {asset};
 const tx = value(await admin.from('transactions').insert({
  user_id: owner.id, asset_account_id: asset.id, organization_id: organization,
  transaction_type: organization ? 'PURCHASE' : 'OPENING_BALANCE', transaction_date: '2025-01-01',
  quantity: 10, unit_price: 300, currency: 'SAR', base_currency: 'SAR', base_value: 3000, gross_value: 3000, created_by: owner.id,
 }).select('id').single());
 const lot = value(await admin.from('lots').insert({
  user_id: owner.id, asset_account_id: asset.id, source_transaction_id: tx.id, acquisition_date: '2025-01-01',
  original_quantity: 10, remaining_quantity: 10, original_value_base: 3000, remaining_value_base: 3000,
 }).select('id').single());
 return {asset, lot};
}

async function finances(ownerId, assessmentId) {
 const tables = ['transactions', 'lots', 'transaction_allocations', 'transfers',
  'zakat_hawl_cycles', 'zakat_assessments', 'zakat_payments', 'zakat_payment_allocations'];
 const rows = await Promise.all(tables.map(async table => [
  table, value(await admin.from(table).select('*').eq('user_id', ownerId).order('id')),
 ]));
 return {
  ...Object.fromEntries(rows),
  lines: value(await admin.from('zakat_assessment_lines').select('*').eq('assessment_id', assessmentId).order('id')),
 };
}

const legacy = {quantity: 10, purchase_price: 300, purchase_value: 3000, market_price: 350, market_value: 3500};
const complete = {...legacy, acquisition_mode: 'OPENING_BALANCE', purchase_date: '2025-01-01', fx_rate: 1};
const dbAsset = async id => value(await admin.from('asset_accounts').select('*').eq('id',id).single());
const evidence = [];
let server, browser;
try {
 const owner = await user(), foreign = await user();
 const {id:organization} = value(await owner.client.from('organizations').insert({
  name: 'QA Asset Edit Company', owner_user_id: owner.id,
 }).select('id').single());
 const {asset: oldGold, lot} = await seed(owner,'QA Legacy Gold',legacy,{history:true});
 const {asset: thinAsset} = await seed(owner,'QA No History',{}, {type:'OTHER'});
 const {asset: orgAsset} = await seed(owner,'QA Legacy VAT',{...complete, acquisition_mode:'PURCHASE',
  tax_category:'S', vat_input_mode:'AMOUNT', vat_amount:0}, {history:true, organization});
 const {asset: completeAsset} = await seed(owner,'QA Complete Gold',complete,{history:true});
 const {asset: bank} = await seed(owner,'QA Proceeds',{}, {type:'BANK'});
 for (const [date,quantity,sale] of [['2025-03-01',2,800],['2025-04-01',2,900]]) {
  value(await owner.client.rpc('post_sale_with_proceeds',{
   p_user_id:owner.id,p_asset_account_id:oldGold.id,p_destination_account_id:bank.id,p_date:date,
   p_quantity:quantity,p_sale_value:sale,p_currency:'SAR',p_base_currency:'SAR',p_base_value:sale,
  }));
 }
 const method = value(await admin.from('zakat_methods').select('id').limit(1).single());
 const assessment = value(await admin.from('zakat_assessments').insert({
  user_id:owner.id,method_id:method.id,assessment_date:'2026-01-01',valuation_date:'2026-01-01',
  nisab_standard:'GOLD',nisab_quantity:85,nisab_value_base:850,total_zakatable_value:2100,zakat_rate:0.025,
  zakat_due:52.5,currency:'SAR',status:'CONFIRMED',calculation_snapshot:{schemaVersion:2,candidateLots:1},
 }).select('id').single());
 value(await admin.from('zakat_assessment_lines').insert({
  assessment_id:assessment.id,lot_id:lot.id,quantity:6,valuation_price:350,market_value:2100,eligible_value:2100,
  zakat_amount:52.5,eligibility_status:'ELIGIBLE',explanation:'Synthetic frozen valuation',
 }));
 const snapshot = await finances(owner.id,assessment.id);
 const bankBefore = await dbAsset(bank.id);
 assert.equal(snapshot.transaction_allocations.length, 2);
 server=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','-H','127.0.0.1','-p','3000'],{
  env:{...process.env,NEXT_PUBLIC_SUPABASE_URL:settings.API_URL,NEXT_PUBLIC_SUPABASE_ANON_KEY:settings.ANON_KEY,
   NEXT_PUBLIC_APP_URL:app,NEXT_PUBLIC_APP_ENV:'test',SUPABASE_SERVICE_ROLE_KEY:'',RESEND_API_KEY:''},cwd:process.env.ASSET_APP_DIR||process.cwd(), stdio:'inherit',
 });
 let ready=false;
 for(let i=0;i<120;i++){
  try{if((await fetch(app+'/ar/login',{signal:AbortSignal.timeout(2000)})).ok){ready=true;break;}}catch{}
  await delay(500);
 }
 assert.ok(ready);
 browser=await chromium.launch({headless:true});
 await mkdir('asset-edit-qa',{recursive:true});
 const mobile = await context(browser,owner,{width:390,height:844});
 const desktop = await context(browser,owner,{width:1440,height:960});
 const cases = [
  {asset:oldGold, locale:'ar', ctx:mobile, block:'أدخل الاسم وتاريخ الشراء', price:410},
  {asset:thinAsset, locale:'ar', ctx:mobile, block:'راجع الحقول المحددة'},
  {asset:orgAsset, locale:'en', ctx:desktop, block:'Check tax settings', price:390},
  {asset:completeAsset, locale:'en', ctx:desktop, price:375},
 ];
 for (const {asset,locale,ctx,block,price} of cases) {
  const page = await ctx.newPage();
  const ar = locale === 'ar';
  const scope = asset.ownership_scope;
  const puts = [];
  const routePath = response => new URL(response.url()).pathname === '/api/assets';
  page.on('request', request => {
   if (request.method() === 'PUT' && routePath(request)) puts.push(request.postDataJSON());
  });
  const path = app+'/'+locale+'/assets?scope='+scope;
  await page.goto(path,{waitUntil:'domcontentloaded',timeout:90000});
  const all = page.locator('.asset-lifecycle-tabs').getByRole('button',{name:ar?'الكل':'All',exact:true});
  const editLabel = ar?'تعديل بيانات الأصل':'Edit asset data';
  async function open(currentName) {
   await all.click({timeout:30000});
   await page.getByRole('row').filter({hasText:currentName}).getByRole('button',{
    name:ar?'التفاصيل والإجراءات':'Details and actions',exact:true,
   }).click({timeout:30000});
   await page.getByRole('dialog').getByRole('button',{name:editLabel,exact:true}).click();
  }
  const name = page.locator('.asset-entry').getByRole('textbox',{name:ar?/اسم الأصل/:/Name/});
  const valuation = page.getByTestId('asset-entry-market-unit');
  const form = page.locator('.asset-entry form');
  const save = form.getByRole('button',{name:ar?'حفظ التعديلات':'Save changes',exact:true});
  const original = await dbAsset(asset.id);
  await open(original.name);
  const editedName = original.name+' reviewed';
  await name.fill(editedName);
  if (before && block) {
   await save.click();
   const alert = form.getByRole('alert');
   await alert.getByText(block,{exact:false}).waitFor();
   const invalid = await form.locator('[aria-invalid="true"]').evaluateAll(controls => controls.map(el => el.getAttribute('data-testid')));
   assert.equal(puts.length,0);
   assert.deepEqual(await dbAsset(asset.id),original);
   evidence.push({scenario:asset.name, change:'name', puts:0, invalid, message:await alert.innerText()});
   if (price && scope==='PERSONAL') {
    await name.fill(original.name);
    await valuation.fill(String(price));
    await save.click();
    await alert.getByText(block,{exact:false}).waitFor();
    assert.equal(puts.length,0);
    assert.deepEqual(await dbAsset(asset.id),original);
    evidence.push({scenario:asset.name, change:'valuation', puts:0, message:await alert.innerText()});
   }
   await form.getByRole('alert').scrollIntoViewIfNeeded();
   await page.screenshot({path:`asset-edit-qa/before-${asset.name.replaceAll(' ','-')}.png`});
  } else {
   const put = page.waitForResponse(response => routePath(response) && response.request().method()==='PUT');
   await save.click();
   const result = await put;
   assert.equal(result.status(),200,await result.text());
   await form.waitFor({state:'detached'});
   const renamed = await dbAsset(asset.id);
   assert.equal(renamed.name,editedName);
   evidence.push({scenario:asset.name, change:'name', before:original.name, after:renamed.name, status:result.status(), puts:puts.length});
   if (!before) {
    assert.deepEqual(Object.keys(puts[0]).sort(),['expected_updated_at','id','name']);
    assert.deepEqual(renamed,{...original,name:editedName,updated_at:renamed.updated_at});
    if (price) {
     await open(editedName);
     await valuation.fill(String(price));
     const secondPut = page.waitForResponse(response => routePath(response) && response.request().method()==='PUT');
     await form.evaluate(element => {element.requestSubmit();element.requestSubmit();});
     const secondResult = await secondPut;
     assert.equal(secondResult.status(),200,await secondResult.text());
     await form.waitFor({state:'detached'});
     assert.equal(puts.length,2);
     assert.deepEqual(Object.keys(puts[1]).sort(),['expected_updated_at','id','market_price','name']);
    }
    await open(editedName);
    assert.equal(await name.inputValue(),editedName);
    if (price) assert.equal(await valuation.inputValue(),String(price));
    await page.reload({waitUntil:'domcontentloaded'});
    await open(editedName);
    assert.equal(await name.inputValue(),editedName);
    const persisted = await dbAsset(asset.id);
    const {data:list,error}=await ctx.request.get(app+'/api/assets').then(async response=>({data:await response.json(),error:!response.ok()}));
    assert.equal(error,false);
    const listed = list.find(row => row.id===asset.id);
    assert.equal(listed.name,editedName);
    if (price) {
     assert.equal(await valuation.inputValue(),String(price));
     assert.equal(persisted.metadata.market_price_per_unit,price);
     assert.equal(persisted.metadata.market_value,price*10);
     assert.equal(listed.current_market_value,price*(asset.id===oldGold.id?6:10));
     const permitted = ['market_price','market_price_per_unit','market_value','estimated_value',
      'market_price_currency','market_price_source','market_valuation_date','market_value_auto'];
     const originalFields = metadata => Object.fromEntries(Object.entries(metadata).filter(([key])=>!permitted.includes(key)));
     assert.deepEqual(originalFields(persisted.metadata),originalFields(original.metadata));
     evidence.push({scenario:asset.name,change:'valuation',currency:'SAR',unitPriceBefore:350,unitPriceAfter:price,
      quantity:listed.current_quantity,cost:listed.current_cost_value,liveValuationAfter:listed.current_market_value,
      persistedAfterReload:true,putsForValuation:1});
    }
    const audits = value(await admin.from('audit_logs').select('*').eq('entity_id',asset.id).eq('action','UPDATE_ASSET_DETAILS').order('created_at'));
    assert.equal(audits.length,price?2:1);
    assert.deepEqual(audits[0].old_data,original);
    assert.deepEqual(audits.at(-1).new_data,persisted);
    await name.scrollIntoViewIfNeeded();
    await page.screenshot({path:`asset-edit-qa/after-${asset.name.replaceAll(' ','-')}.png`});
   }
  }
  await page.close();
 }
 if (!before) {
  const denied = await context(browser,foreign,{width:390,height:844});
  const put = (ctx,asset,changes) => ctx.request.put(app+'/api/assets',{headers:{origin:app},data:{
   id:asset.id,expected_updated_at:asset.updated_at,name:asset.name,...changes,
  }});
  assert.equal((await put(desktop,oldGold,{name:'Stale name'})).status(),409);
  assert.equal((await put(denied,await dbAsset(oldGold.id),{name:'Unauthorized'})).status(),404);
  assert.equal((await put(denied,await dbAsset(orgAsset.id),{name:'Unauthorized'})).status(),404);
  assert.equal((await put(desktop,await dbAsset(thinAsset.id),{market_price:400})).status(),400);
  assert.equal((await put(desktop,await dbAsset(oldGold.id),{metadata:{purchase_value:1}})).status(),400);
  assert.deepEqual(await finances(owner.id,assessment.id),snapshot);
  assert.deepEqual(await dbAsset(bank.id),bankBefore);
  evidence.push({financialRowsUnchanged:true,fifoAllocations:2,remainingGoldQuantity:6,remainingGoldCostSAR:1800,
   bankProceedsSAR:1700,frozenZakatSAR:52.5,conflictStatus:409,crossScopeStatus:404});
 }
 console.log(JSON.stringify({phase:before?'before':'after',evidence},null,2));
 await import('node:fs/promises').then(({writeFile})=>writeFile(
  `asset-edit-qa/${before?'before':'after'}.json`, JSON.stringify(evidence,null,2)+'\n',
 ));
} finally {
 await browser?.close();
 if (server) {
  const exited = new Promise(resolve => server.once('exit',resolve));
  server.kill();
  if (server.exitCode === null && server.signalCode === null) await exited;
 }
}
