// Uses only clean local CI infrastructure and synthetic records.
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {createClient} from '@supabase/supabase-js';
import {createServerClient} from '@supabase/ssr';

console.log('Asset QA phase:', process.env.ASSET_EDIT_PHASE);
const root=process.env.ASSET_QA_ROOT;
assert.ok(root && process.env.RUNNER_TEMP && root.startsWith(process.env.RUNNER_TEMP+'/'));
const settings=JSON.parse(execFileSync('npx',['--yes','supabase@2.122.0','status','--workdir',root,'--output','json'],
 {encoding:'utf8',stdio:['ignore','pipe','pipe']}));
assert.equal(settings.API_URL,'http://127.0.0.1:54321');
const app='http://localhost:3000';
const providerTrace=root+'/provider-calls.log';
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
 ctx.setDefaultTimeout(20000);
 ctx.setDefaultNavigationTimeout(45000);
 await ctx.addCookies(account.cookies.map(({name,value})=>({name,value,url:app})));
 await ctx.addInitScript(()=>localStorage.setItem('zf-theme','yaqeen-business'));
 return ctx;
}
const before = process.env.ASSET_EDIT_PHASE === 'before';

async function seed(owner, name, metadata, {organization = null, history = false, type = 'GOLD', date = '2025-01-01'} = {}) {
 const asset = value(await admin.from('asset_accounts').insert({
  user_id: owner.id, name, asset_type: type, unit: type === 'GOLD' ? 'g' : 'unit', currency: 'SAR',
  ownership_scope: organization ? 'ORGANIZATION' : 'PERSONAL', organization_id: organization, metadata,
 }).select('*').single());
 if (!history) return {asset};
 const quantity = Number(metadata.quantity ?? 10), cost = quantity*300;
 const tx = value(await admin.from('transactions').insert({
  user_id: owner.id, asset_account_id: asset.id, organization_id: organization,
  transaction_type: organization ? 'PURCHASE' : 'OPENING_BALANCE', transaction_date: date,
  quantity, unit_price: 300, currency: 'SAR', base_currency: 'SAR', base_value: cost, gross_value: cost, created_by: owner.id,
 }).select('id').single());
 const lot = value(await admin.from('lots').insert({
  user_id: owner.id, asset_account_id: asset.id, source_transaction_id: tx.id, acquisition_date: date, hawl_start_date: date,
  original_quantity: quantity, remaining_quantity: quantity, original_value_base: cost, remaining_value_base: cost,
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
let server, browser, activePage;
try {
 console.log("Seeding authorized asset and finance fixtures");
 const owner = await user(), foreign = await user();
 const {id:organization} = value(await owner.client.from('organizations').insert({
  name: 'QA Asset Edit Company', owner_user_id: owner.id,
 }).select('id').single());
 const {asset: oldGold, lot} = await seed(owner,'QA Legacy Gold',{...legacy,quantity:20,purchase_value:6000,market_value:7000},{history:true});
 const {asset: thinAsset} = await seed(owner,'QA No History',{}, {type:'OTHER'});
 const {asset: orgAsset} = await seed(owner,'QA Legacy VAT',{...complete, acquisition_mode:'PURCHASE',
  tax_category:'S', vat_input_mode:'AMOUNT', vat_amount:0}, {history:true, organization});
 const {asset: completeAsset} = await seed(owner,'QA Complete Gold',complete,{history:true});
 const {asset: bank} = await seed(owner,'QA Proceeds',{}, {type:'BANK'});
 for (const [date,quantity,sale] of [['2025-03-01',2,800],['2025-04-01',3,900]]) {
  value(await owner.client.rpc('post_sale_with_proceeds',{
   p_user_id:owner.id,p_asset_account_id:oldGold.id,p_destination_account_id:bank.id,p_date:date,
   p_quantity:quantity,p_sale_value:sale,p_currency:'SAR',p_base_currency:'SAR',p_base_value:sale,
  }));
 }
 const method = value(await admin.from('zakat_methods').select('id').limit(1).single());
 const assessment = value(await admin.from('zakat_assessments').insert({
  user_id:owner.id,method_id:method.id,assessment_date:'2026-01-01',valuation_date:'2026-01-01',
  nisab_standard:'GOLD',nisab_quantity:85,nisab_value_base:850,total_zakatable_value:5250,zakat_rate:0.025,
  zakat_due:131.25,currency:'SAR',status:'CONFIRMED',calculation_snapshot:{schemaVersion:2,candidateLots:1},
 }).select('id').single());
 value(await admin.from('zakat_assessment_lines').insert({
  assessment_id:assessment.id,lot_id:lot.id,quantity:15,valuation_price:350,valuation_currency:'SAR',fx_rate:1,market_value:5250,eligible_value:5250,
  zakat_amount:131.25,eligibility_status:'ELIGIBLE',explanation:'Synthetic frozen valuation',
 }));
 let machine, depreciation, retainedProviderGold, legacyGold, legacySilver, stock, stockLot, finalAssessment, closedCycle, futureDate;
 if (!before) {
  machine = value(await owner.client.rpc('create_asset_with_acquisition',{
   p_asset:{name:'QA Depreciated Machine',asset_type:'OTHER',asset_class_code:'PPE',asset_type_code:'MACHINERY',
    currency:'SAR',ownership_scope:'ORGANIZATION',organization_id:organization,
    metadata:{quantity:2,purchase_value:1000,purchase_date:'2026-01-01',acquisition_mode:'OPENING_BALANCE',market_price:600}},
   p_request_id:randomUUID(),
  }));
  const command = value(await owner.client.rpc('prepare_asset_lifecycle',{
   p_asset_id:machine.id,p_payload:{operation:'DEPRECIATION',date:'2026-02-01',amount:100},p_request_id:randomUUID(),
  }));
  depreciation = command.financial_event_id;
  for (const p_status of ['PLANNED','COMMITTED','APPROVE','ACTUAL']) {
   const action = p_status==='APPROVE'
    ? owner.client.rpc('approve_financial_event',{p_event_id:depreciation,p_note:'QA depreciation'})
    : owner.client.rpc('transition_financial_event',{p_event_id:depreciation,p_new_status:p_status,p_note:'QA depreciation'});
   value(await action);
  }
  ({asset:retainedProviderGold} = await seed(owner,'QA Saved Provider Gold',{...complete,market_price_per_unit:350,
   market_value_auto:true,market_price_source:'ALYAWMGOLD_LIVE_SA',market_valuation_date:'2025-01-01'}, {history:true}));
  ({asset:legacyGold} = await seed(owner,'QA Manual Reference Gold',{
   ...complete,karat:18,market_price_per_unit:350,market_value:2625,market_value_auto:true,
   market_price_source:'MANUAL_MARKET_PRICE',market_price_currency:'SAR',market_fx_rate:1,market_valuation_date:'2025-04-30',
  }, {history:true}));
  ({asset:legacySilver} = await seed(owner,'QA Manual Reference Silver',{
   ...complete,purity:925,market_price:10,market_price_per_unit:10,market_value:92.5,market_value_auto:true,
   market_price_source:'MANUAL_MARKET_PRICE',market_price_currency:'SAR',market_fx_rate:1,market_valuation_date:'2025-04-30',
  }, {history:true,type:'SILVER'}));
  value(await owner.client.rpc('post_sale_with_proceeds',{
   p_user_id:owner.id,p_asset_account_id:legacyGold.id,p_destination_account_id:bank.id,p_date:'2025-05-01',
   p_quantity:2,p_sale_value:800,p_currency:'SAR',p_base_currency:'SAR',p_base_value:800,
  }));
  const zakatOwner = await user();
  value(await admin.from('profiles').update({zakat_method_id:method.id}).eq('id',zakatOwner.id));
  ({asset:stock,lot:stockLot} = await seed(zakatOwner,'QA Frozen Stock',{
   ...complete,purchase_date:'2024-10-01',market_valuation_date:'2024-10-01',
  }, {history:true,type:'STOCK',date:'2024-10-01'}));
  stock.qaOwner = zakatOwner;
  futureDate = new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Riyadh'});
 }
 const snapshot = await finances(owner.id,assessment.id);
 const bankBefore = await dbAsset(bank.id);
 assert.equal(snapshot.transaction_allocations.length,before?2:3);
 await writeFile(providerTrace,'');
 console.log("Starting the application");
 server=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','-H','127.0.0.1','-p','3000'],{
  env:{...process.env,ASSET_PROVIDER_TRACE:providerTrace,...(before?{}:{NODE_OPTIONS:`--require ${fileURLToPath(new URL('./metal-quote-fixture.cjs',import.meta.url))}`}),NEXT_PUBLIC_SUPABASE_URL:settings.API_URL,NEXT_PUBLIC_SUPABASE_ANON_KEY:settings.ANON_KEY,
   NEXT_PUBLIC_APP_URL:app,NEXT_PUBLIC_APP_ENV:'test',SUPABASE_SERVICE_ROLE_KEY:'',RESEND_API_KEY:''},cwd:process.env.ASSET_APP_DIR||process.cwd(), stdio:'inherit',
 });
 let ready=false;
 for(let i=0;i<120;i++){
  try{if((await fetch(app+'/ar/login',{signal:AbortSignal.timeout(2000)})).ok){ready=true;break;}}catch{}
  await delay(500);
 }
 assert.ok(ready);
 console.log("Application ready");
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
  const page = activePage = await ctx.newPage();
  console.log(before?'Before:':'After:', asset.name);
  page.on('pageerror', error => console.error('Browser error:',error.message));
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
   const dialog = page.getByRole('dialog');
   if (before) await dialog.getByRole('button',{name:editLabel,exact:true}).click();
   return dialog;
  }
  const name = page.locator('.asset-entry').getByRole('textbox',{name:ar?/اسم الأصل/:/Name/});
  const valuation = page.getByTestId('asset-entry-market-unit');
  const form = page.locator('.asset-entry form');
  const save = form.getByRole('button',{name:ar?'حفظ التعديلات':'Save changes',exact:true});
  const original = await dbAsset(asset.id);
  await open(original.name);
  const editedName = original.name+' reviewed';
  if (before) {
   await name.fill(editedName);
   if (block) {
    await save.click();
    const alert = form.getByRole('alert');
    await alert.getByText(block,{exact:false}).waitFor();
    assert.equal(puts.length,0);
    assert.deepEqual(await dbAsset(asset.id),original);
    evidence.push({scenario:asset.name,puts:0,message:await alert.innerText()});
    if (asset.id===oldGold.id) {
     await name.fill(original.name);
     await valuation.fill(String(price));
     await save.click();
     await alert.getByText(block,{exact:false}).waitFor();
     assert.equal(puts.length,0);
     assert.deepEqual(await dbAsset(asset.id),original);
    }
    await alert.scrollIntoViewIfNeeded();
    await page.screenshot({path:`asset-edit-qa/before-${asset.name.replaceAll(' ','-')}.png`});
   } else {
    const response = page.waitForResponse(res=>routePath(res)&&res.request().method()==='PUT');
    await save.click();
    assert.equal((await response).status(),200);
    await form.waitFor({state:'detached'});
    assert.equal((await dbAsset(asset.id)).name,editedName);
   }
  } else {
   const canRename = asset.id!==oldGold.id;
   const registration = page.getByRole('dialog').getByRole('button',{name:ar?'تعديل بيانات التسجيل':'Edit registration details',exact:true});
   const market = page.getByRole('dialog').getByRole('button',{name:ar?'تحديث السعر السوقي':'Update market price',exact:true});
   let nextName = original.name;
   if (canRename) {
    await registration.click();
    await name.fill(editedName);
    const response = page.waitForResponse(res=>routePath(res)&&res.request().method()==='PUT');
    await save.click();
    const saved = await response;
    assert.equal(saved.status(),200,await saved.text());
    await form.waitFor({state:'detached'});
    assert.equal(puts.length,1);
    assert.deepEqual(Object.keys(puts[0]).sort(),['expected_updated_at','id','name']);
    const renamed = await dbAsset(asset.id);
    assert.deepEqual(renamed,{...original,name:editedName,updated_at:renamed.updated_at});
    nextName = editedName;
    await open(nextName);
   } else {
    const lock = page.getByRole('dialog').getByText('بيانات التسجيل مقفلة لوجود سند بيع.',{exact:false});
    await lock.waitFor();
    assert.equal(await registration.count(),0);
    assert.equal(await lock.getByRole('link').count(),1);
    const forbidden = await ctx.request.put(app+'/api/assets',{data:{id:asset.id,expected_updated_at:original.updated_at,name:editedName}});
    assert.equal(forbidden.status(),409);
    const denied = await forbidden.json();
    assert.equal(denied.error,'ASSET_REGISTRATION_LOCKED');
    assert.equal(denied.registration_lock.operation,'SALE');
    assert.deepEqual(await dbAsset(asset.id),original);
   }
   if (price) {
    await market.click();
    assert.equal(await name.count(),0);
    await valuation.fill(String(price));
    const response = page.waitForResponse(res=>routePath(res)&&res.request().method()==='PUT');
    await form.evaluate(element=>{element.requestSubmit(); element.requestSubmit();});
    const saved = await response;
    assert.equal(saved.status(),200,await saved.text());
    await form.waitFor({state:'detached'});
    assert.equal(puts.length,canRename?2:1);
    assert.deepEqual(Object.keys(puts.at(-1)).sort(),['expected_updated_at','id','market_price']);
    await open(nextName);
    await market.click();
    assert.equal(await valuation.inputValue(),String(price));
   }
   await page.reload({waitUntil:'domcontentloaded'});
   await open(nextName);
   if (price) {
    await market.click();
    assert.equal(await valuation.inputValue(),String(price));
   }
   const persisted = await dbAsset(asset.id);
   const listResponse = await ctx.request.get(app+'/api/assets');
   assert.equal(listResponse.status(),200);
   const listed = (await listResponse.json()).find(row=>row.id===asset.id);
   assert.equal(listed.name,nextName);
   assert.equal(persisted.name,nextName);
   if (price) {
    const quantity = asset.id===oldGold.id?15:10;
    assert.equal(persisted.metadata.market_price_per_unit,price);
    assert.equal(listed.current_market_value,price*quantity);
    assert.equal(listed.current_quantity,quantity);
    if (asset.id===oldGold.id) assert.equal(listed.current_cost_value,4500);
    const permitted = ['market_price','market_price_per_unit','market_value','estimated_value',
     'market_price_currency','market_price_source','market_valuation_date','market_value_auto','market_price_source_mode'];
    const unchanged = metadata=>Object.fromEntries(Object.entries(metadata).filter(([key])=>!permitted.includes(key)));
    assert.deepEqual(unchanged(persisted.metadata),unchanged(original.metadata));
    const [audit] = value(await admin.from('audit_logs').select('*').eq('entity_id',asset.id).eq('action','UPDATE_ASSET_MARKET_VALUATION'));
    assert.deepEqual(audit.new_data,persisted);
    evidence.push({id:asset.id===oldGold.id?'V-13':undefined,scenario:asset.name,price,quantity,
     cost:listed.current_cost_value,marketValue:listed.current_market_value,originalQuantity:persisted.metadata.quantity});
   }
   await page.screenshot({path:`asset-edit-qa/after-${asset.name.replaceAll(' ','-')}.png`});
  }
  await page.close();
 }
 if (!before) {
  const put = (ctx,asset,changes) => ctx.request.put(app+'/api/assets',{data:{
   id:asset.id,expected_updated_at:asset.updated_at,...changes,
  }});
  const policy = async (ctx, id) => {
   const response = await ctx.request.get(app+'/api/assets?edit_asset_id='+id);
   assert.equal(response.status(),200);
   return response.json();
  };
  const assetRow = async (ctx,id) => (await (await ctx.request.get(app+'/api/assets')).json()).find(row=>row.id===id);
  const moveSnapshot = async () => Promise.all(['financial_events','financial_event_lines','asset_lifecycle_commands'].map(async table=>
   value(await admin.from(table).select('*').eq('organization_id',organization).order('id'))));
  const postings = await moveSnapshot();
  console.log("V-14: posted depreciation");
  const machineBefore = await dbAsset(machine.id);
  const machinePolicy = await policy(desktop,machine.id);
  assert.equal(machinePolicy.registration_lock.operation,'DEPRECIATION');
  assert.equal(machinePolicy.asset_registration_can_edit,false);
  assert.equal(machinePolicy.valuation_mode,'MANUAL');
  assert.equal((await put(desktop,machineBefore,{name:'Locked by depreciation'})).status(),409);
  assert.equal((await put(desktop,machineBefore,{market_price:700})).status(),200);
  const machineAfter = await assetRow(desktop,machine.id);
  assert.equal(machineAfter.current_market_value,1400);
  assert.equal(machineAfter.current_cost_value,900);
  const book = (await policy(desktop,machine.id)).book;
  assert.equal(Number(book.gross),1000);
  assert.equal(Number(book.depreciation),100);
  assert.equal(book.net,900);
  assert.deepEqual(book,machinePolicy.book);
  assert.deepEqual(await moveSnapshot(),postings);
  evidence.push({id:'V-14',quote:700,valuation:1400,book,postingsUnchanged:true,source:machineAfter.current_valuation_source,date:machineAfter.current_valuation_date});

  console.log('V-15: legacy manual quotes and global refresh disabled');
  const denied = await context(browser,foreign,{width:390,height:844});
  const priceRows = async () => value(await admin.from('market_prices').select('*').order('id'));
  const savedPrices = await priceRows();
  const providerBefore = await dbAsset(retainedProviderGold.id);
  assert.equal((await assetRow(desktop,retainedProviderGold.id)).current_price_source_mode,'PROVIDER');
  for (const url of [
   '/api/prices?live=1',
   '/api/prices?live=1&asset_id='+retainedProviderGold.id,
   '/api/prices?live=1&asset_id='+legacyGold.id,
   '/api/prices?live=1&asset_id='+legacySilver.id,
  ]) {
   const response = await desktop.request.get(app+url);
   assert.equal(response.status(),403);
   assert.equal((await response.json()).error,'GLOBAL_METAL_PRICE_LINK_DISABLED');
  }
  assert.deepEqual(await dbAsset(retainedProviderGold.id),providerBefore);
  const manualFixtures = [
   {asset:legacyGold,oldQuote:350,newQuote:410,oldValue:2100,newValue:2460,storedTotal:3075,remaining:8},
   {asset:legacySilver,oldQuote:10,newQuote:12,oldValue:92.5,newValue:111,storedTotal:111,remaining:10},
  ];
  for (const {asset,oldQuote,newQuote,oldValue,newValue,storedTotal,remaining} of manualFixtures) {
   const original = await dbAsset(asset.id);
   const old = await assetRow(desktop,asset.id);
   assert.equal(old.current_price_source_mode,'MANUAL');
   assert.equal(old.current_valuation_auto,true);
   assert.equal(old.current_market_price,oldQuote);
   assert.equal(old.current_market_value,oldValue);
   const access = await policy(desktop,asset.id);
   assert.equal(access.valuation_mode,'MANUAL');
   if (asset.id===legacyGold.id) {
    assert.equal(access.registration_lock.operation,'SALE');
    const failed = await put(desktop,original,{name:'Locked by sale'});
    assert.equal(failed.status(),409);
   }
   const page = activePage = await desktop.newPage();
   const open = async () => {
    await page.getByRole('row').filter({hasText:asset.name}).getByRole('button',{name:'Details and actions',exact:true}).click();
   };
   let browserLiveRequests = 0;
   page.on('request', request=>{
    const url = new URL(request.url());
    if (url.pathname==='/api/prices' && url.searchParams.get('live')==='1') browserLiveRequests++;
   });
   await page.goto(app+'/en/assets?scope=PERSONAL',{waitUntil:'domcontentloaded'});
   await open();
   const dialog = page.getByRole('dialog');
   await dialog.getByText(/MANUAL_MARKET_PRICE/).waitFor();
   const update = dialog.getByRole('button',{name:'Update market price',exact:true});
   await update.waitFor();
   assert.equal(await dialog.getByRole('button',{name:'Refresh price from source',exact:true}).count(),0);
   assert.deepEqual(await dbAsset(asset.id),original);
   await update.click();
   await page.getByTestId('asset-entry-market-unit').fill(String(newQuote));
   await page.getByRole('button',{name:'Save changes',exact:true}).click();
   await page.locator('.asset-entry form').waitFor({state:'detached'});
   await page.reload({waitUntil:'domcontentloaded'});
   await open();
   await dialog.getByText(/USER_MANUAL/).waitFor();
   const persisted = await dbAsset(asset.id), after = await assetRow(desktop,asset.id);
   assert.equal(after.current_price_source_mode,'MANUAL');
   assert.equal(after.current_market_price,newQuote);
   assert.equal(after.current_market_value,newValue);
   assert.equal(after.current_quantity,remaining);
   assert.equal(persisted.metadata.market_value,storedTotal);
   assert.equal(persisted.metadata.market_value_auto,true);
   assert.equal(persisted.metadata.market_fx_rate,original.metadata.market_fx_rate);
   assert.equal(persisted.metadata.market_price_currency,original.metadata.market_price_currency);
   assert.equal(persisted.metadata.purchase_value,original.metadata.purchase_value);
   const audits = value(await admin.from('audit_logs').select('old_data,new_data').eq('entity_id',asset.id).eq('action','UPDATE_ASSET_MARKET_VALUATION'));
   assert.deepEqual(audits,[{old_data:original,new_data:persisted}]);
   assert.equal(browserLiveRequests,0);
   await page.screenshot({path:`asset-edit-qa/V-15-${asset.asset_type}.png`});
   await page.close();
   evidence.push({id:'V-15',type:asset.asset_type,oldQuote,newQuote,oldValue,newValue,remaining,derivedValuePreserved:true,browserLiveRequests});
  }
  assert.deepEqual(await priceRows(),savedPrices);
  assert.equal(await readFile(providerTrace,'utf8'),'');
  evidence.push({id:'V-15',providerCalls:0,refreshStatus:403,referenceRowsUnchanged:true,existingProviderQuoteUnchanged:true});

  console.log('V-16: finalized Zakat');
  const tax = await context(browser,stock.qaOwner,{width:1440,height:960});
  async function assess(date) {
   const response = await tax.request.post(app+'/api/assessments',{data:{
    assessment_date:date,method_id:method.id,nisab_standard:'SILVER',gold_price:350,silver_price:1,
    price_currency:'SAR',price_mode:'MANUAL',nisab_reached_date:'2024-10-01',
   }});
   assert.equal(response.status(),201,await response.text());
   return response.json();
  }
  const old = await assess('2025-10-10');
  finalAssessment = old.assessment.id;
  closedCycle = old.cycle.id;
  value(await stock.qaOwner.client.rpc('close_zakat_cycle',{p_cycle_id:closedCycle,p_final_assessment_id:finalAssessment}));
  const savedAssessment = async () => ({
   assessment:value(await admin.from('zakat_assessments').select('*').eq('id',finalAssessment).single()),
   lines:value(await admin.from('zakat_assessment_lines').select('*').eq('assessment_id',finalAssessment).order('id')),
   cycle:value(await admin.from('zakat_hawl_cycles').select('*').eq('id',closedCycle).single()),
  });
  const frozen = await savedAssessment();
  assert.equal(frozen.cycle.status,'CLOSED');
  assert.equal(frozen.lines[0].valuation_price,350);
  const stockBefore = await dbAsset(stock.id);
  assert.equal((await policy(tax,stock.id)).registration_lock.code,'ZAKAT');
  assert.equal((await put(tax,stockBefore,{name:'Locked by Zakat'})).status(),409);
  assert.equal((await put(tax,stockBefore,{market_price:410})).status(),200);
  assert.deepEqual(await savedAssessment(),frozen);
  const future = await assess(futureDate);
  const newLine = future.lines.find(line=>line.lot_id===stockLot.id);
  assert.equal(Number(newLine.valuation_price),410);
  assert.equal(Number(newLine.market_value),4100);
  assert.deepEqual(await savedAssessment(),frozen);
  evidence.push({id:'V-16',finalQuote:350,finalMarket:frozen.lines[0].market_value,
   futureQuote:410,futureMarket:4100,finalSnapshotUnchanged:true});

  assert.equal((await put(desktop,completeAsset,{name:'Stale name'})).status(),409);
  assert.equal((await put(denied,await dbAsset(oldGold.id),{name:'Unauthorized'})).status(),404);
  assert.equal((await put(denied,await dbAsset(orgAsset.id),{name:'Unauthorized'})).status(),404);
  value(await admin.from('organization_members').insert({
   organization_id:organization,user_id:foreign.id,role:'VIEWER',status:'ACTIVE',
  }));
  assert.equal((await put(denied,await dbAsset(orgAsset.id),{name:'Unauthorized viewer'})).status(),403);
  assert.equal((await put(desktop,await dbAsset(thinAsset.id),{market_price:400})).status(),400);
  assert.equal((await put(desktop,await dbAsset(oldGold.id),{metadata:{purchase_value:1}})).status(),400);
  assert.deepEqual(await finances(owner.id,assessment.id),snapshot);
  assert.deepEqual(await dbAsset(bank.id),bankBefore);
  evidence.push({financialRowsUnchanged:true,fifoAllocations:3,bankProceedsSAR:2500,conflictStatus:409,crossScopeStatus:404,viewerStatus:403});
 }
 console.log(JSON.stringify({phase:before?'before':'after',evidence},null,2));
 await writeFile(
  `asset-edit-qa/${before?'before':'after'}.json`, JSON.stringify(evidence,null,2)+'\n',
 );
} catch (error) {
 if (activePage && !activePage.isClosed()) {
  try { await activePage.screenshot({path:'asset-edit-qa/failure.png',timeout:2000}); } catch {}
 }
 throw error;
} finally {
 await browser?.close();
 if (server) {
  const exited = new Promise(resolve => server.once('exit',resolve));
  server.kill();
  if (server.exitCode === null && server.signalCode === null) {
   const hardStop = setTimeout(()=>server.kill('SIGKILL'),5000);
   await exited;
   clearTimeout(hardStop);
  }
 }
}
