// Uses only clean local CI infrastructure and synthetic records.
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdir,readFile} from 'node:fs/promises';
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

async function seed(owner,organization_id=null,manualGold=false,name){
 const src=organization_id?admin:owner.client;
 const {id}=value(await src.from('asset_accounts').insert({
  user_id:owner.id,name:name??(organization_id?'QA Equipment Register':manualGold?'QA 18K Gold':'QA Gold Statement'),
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

async function context(browser,account,viewport,theme='yaqeen-business'){
 const ctx=await browser.newContext({viewport});
 await ctx.addCookies(account.cookies.map(({name,value})=>({name,value,url:app})));
 await ctx.addInitScript(theme=>localStorage.setItem('zf-theme',theme),theme);
 return ctx;
}
function today(){
 return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
}

async function verifySavedAssessmentMethod(browser) {
 const methods=value(await admin.from('zakat_methods').select('id,code,calendar_type')
   .in('code',['INDEPENDENT_LOTS','UNIFIED_HAWL']).order('code'));
 assert.equal(methods.length,2);
 for(const savedMethod of methods) {
  const owner=await user();
  const otherMethod=methods.find(method=>method.id!==savedMethod.id);
  value(await admin.from('profiles').update({base_currency:'SAR',nisab_standard:'GOLD',zakat_method_id:savedMethod.id}).eq('id',owner.id));
  const start='2025-03-01';
  const due=value(await owner.client.rpc('zakat_next_hawl_date',{p_start:start,p_calendar:savedMethod.calendar_type}));
  const cycle=value(await owner.client.from('zakat_hawl_cycles').insert({
   user_id:owner.id,cycle_no:1,nisab_standard:'GOLD',nisab_value_base:34000,nisab_reached_date:start,
   hawl_start_date:start,hawl_due_date:due,status:'ACTIVE',snapshot:{personal_start_policy:'SETTLED_OPENING_V1'},
  }).select('id').single());
  const gold=value(await owner.client.from('asset_accounts').insert({
   user_id:owner.id,name:'QA saved assessment method',asset_type:'GOLD',unit:'g',currency:'SAR',
   ownership_scope:'PERSONAL',is_zakatable:true,metadata:{karat:24},
  }).select('id').single());
  const tx=value(await owner.client.from('transactions').insert({
   user_id:owner.id,asset_account_id:gold.id,transaction_type:'PURCHASE',transaction_date:start,
   quantity:90,currency:'SAR',base_currency:'SAR',base_value:36000,
  }).select('id').single());
  value(await owner.client.from('lots').insert({
   user_id:owner.id,asset_account_id:gold.id,source_transaction_id:tx.id,acquisition_date:start,hawl_start_date:start,
   original_quantity:90,remaining_quantity:90,original_value_base:36000,remaining_value_base:36000,
  }));
  const ctx=await context(browser,owner,{width:1280,height:900});
  try {
   const page=await ctx.newPage();
   for(const locale of ['ar','en']) {
    const method=page.getByRole('combobox',{name:locale==='ar'?'المنهج':'Method',exact:true});
    const waitForMethods=()=>method.locator('option').filter({hasText:/UNIFIED_HAWL/}).waitFor({state:'attached'});
    await page.goto(app+'/'+locale+'/assessments?scope=PERSONAL');
    await waitForMethods();
    assert.equal(await method.inputValue(),savedMethod.id,locale+' initial '+savedMethod.code);
    await page.reload();
    await waitForMethods();
    assert.equal(await method.inputValue(),savedMethod.id,locale+' reload '+savedMethod.code);
   }
   const method=page.getByRole('combobox',{name:'Method',exact:true});
   await page.getByLabel('Assessment date',{exact:true}).fill(due);
   await page.getByRole('combobox',{name:'Nisab standard',exact:true}).selectOption('GOLD');
   await page.getByLabel('Pure gold / g',{exact:true}).fill('400');
   await page.getByLabel('Pure silver / g',{exact:true}).fill('5');
   await method.selectOption(otherMethod.id);
   const manualResponse=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/assessments'&&r.request().method()==='POST');
   await page.getByRole('button',{name:'New assessment',exact:true}).click();
   const manual=await manualResponse;
   assert.ok(manual.ok(),await manual.text());
   const {assessment:original}=await manual.json();
   assert.equal(original.method_id,otherMethod.id);

   await page.reload();
   await method.locator('option').filter({hasText:/UNIFIED_HAWL/}).waitFor({state:'attached'});
   assert.equal(await method.inputValue(),savedMethod.id);
   await page.getByRole('button',{name:'Recalculate',exact:true}).click();
   assert.equal(await method.inputValue(),otherMethod.id);
   await method.selectOption(savedMethod.id);
   const revisedResponse=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/assessments/'+original.id&&r.request().method()==='PATCH');
   await page.getByRole('button',{name:'Save recalculation',exact:true}).click();
   const revised=await revisedResponse;
   assert.ok(revised.ok(),await revised.text());
   const {assessment}=await revised.json();
   assert.equal(assessment.method_id,savedMethod.id);
   assert.equal(Number(assessment.zakat_due),900);

   page.once('dialog',dialog=>dialog.accept());
   const finalResponse=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/assessments/confirm'&&r.request().method()==='POST');
   await page.getByRole('button',{name:'Finalize assessment',exact:true}).click();
   const final=await finalResponse;
   assert.ok(final.ok(),await final.text());
   const closed=value(await owner.client.from('zakat_hawl_cycles').select('status,final_assessment_id').eq('id',cycle.id).single());
   assert.equal(closed.status,'CLOSED');
   assert.equal(closed.final_assessment_id,assessment.id);
   const finalized=value(await owner.client.from('zakat_assessments').select('method_id,assessment_kind').eq('id',assessment.id).single());
   assert.deepEqual(finalized,{method_id:savedMethod.id,assessment_kind:'FINAL'});
   console.log('PASS stored assessment method on AR/EN initial load and reload, override and finalization',savedMethod.code);
  }finally{await ctx.close();}
 }
}

async function verifyFirstNisabCycle(browser) {
 const owner=await user();
 const client=owner.client;
 const method=value(await client.from('zakat_methods').select('id').eq('code','INDEPENDENT_LOTS').single());
 value(await admin.from('profiles').update({base_currency:'SAR',zakat_method_id:method.id}).eq('id',owner.id));
 const gold=value(await client.from('asset_accounts').insert({user_id:owner.id,name:'QA Nisab evidence',
   metadata:{karat:24},asset_type:'GOLD',unit:'g',currency:'SAR',ownership_scope:'PERSONAL',is_zakatable:true}).select('id').single());
 for(const [date,quantity] of [['2023-02-01',40],['2023-02-03',50]]){
   const tx=value(await client.from('transactions').insert({user_id:owner.id,asset_account_id:gold.id,transaction_type:'PURCHASE',
     transaction_date:date,quantity,currency:'SAR',base_currency:'SAR',base_value:quantity*350}).select('id').single());
   value(await client.from('lots').insert({user_id:owner.id,asset_account_id:gold.id,source_transaction_id:tx.id,
     acquisition_date:date,hawl_start_date:date,original_quantity:quantity,remaining_quantity:quantity,
     original_value_base:quantity*350,remaining_value_base:quantity*350}));
 }
 value(await admin.from('market_prices').insert({asset_type:'GOLD',instrument_code:'XAU',currency:'SAR',price_per_unit:425,valuation_date:'2023-02-03',source:'QA_NISAB'}));
 const ctx=await context(browser,owner,{width:1280,height:900});
 try {
   const page=await ctx.newPage();
   await page.goto(app+'/en/assessments?scope=PERSONAL');
   const panel=page.locator('section').filter({has:page.getByRole('heading',{name:'Nisab & Hawl start method'})});
   await panel.getByLabel('Nisab standard').selectOption('GOLD');
   await panel.getByRole('button',{name:'Verify first Nisab date'}).click();
   await panel.getByText(/QA_NISAB 425/).waitFor();
   assert.equal(await panel.locator('input[type=date]').inputValue(),'2023-02-03');
   const post=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/zakat-cycles/start');
   await panel.getByRole('button',{name:'Start cycle',exact:true}).click();
   const response=await post;
   assert.ok(response.ok(),await response.text());
   await page.reload();
   await page.getByRole('heading',{name:'Current cycle #1'}).waitFor();
   const cycle=value(await client.from('zakat_hawl_cycles').select('*').eq('user_id',owner.id).single());
   assert.equal(cycle.hawl_start_date,'2023-02-03');
   assert.equal(cycle.snapshot.nisabEvidence.value,'38250');
   assert.equal(cycle.snapshot.nisabEvidence.movementIds.length,2);
   const periods=value(await client.rpc('zakat_lot_hawl_periods',{p_calendar:'GREGORIAN'}));
   assert.deepEqual(periods.map(p=>p.hawl_due_date),['2024-02-03','2024-02-03']);
   const pageAr=await ctx.newPage();
   await pageAr.goto(app+'/ar/assessments?scope=PERSONAL');
   await pageAr.getByLabel('تاريخ بلوغ المحفظة للنصاب',{exact:true}).waitFor({state:'hidden'});
   await pageAr.locator('label').filter({hasText:/^المنهج/}).locator('select').selectOption(method.id);
   await pageAr.getByLabel('تاريخ الاحتساب',{exact:true}).fill('2023-02-04');
   await pageAr.getByLabel('سعر الذهب الخالص / g',{exact:true}).fill('425');
   await pageAr.getByLabel('سعر الفضة الخالصة / g',{exact:true}).fill('5');
   const preview=pageAr.waitForResponse(r=>new URL(r.url()).pathname==='/api/assessments' && r.request().method()==='POST');
   await pageAr.getByRole('button',{name:'إجراء احتساب جديد',exact:true}).click();
   const saved=await preview;
   assert.ok(saved.ok(),await saved.text());
   const {assessment}=await saved.json();
   assert.equal(Number(assessment.zakat_due),0);
   assert.equal(assessment.hawl_cycle_id,cycle.id);
 }finally{await ctx.close();}
}

async function verifyJuneZakatPayment(browser) {
 const owner = await user();
 const client = owner.client;
 const bankName = 'QA June Zakat Bank';
 const assessDate = '2026-06-12';
 const paymentDate = '2026-06-13';
 value(await admin.from('profiles').update({base_currency:'SAR'}).eq('id',owner.id));
 const method = value(await client.from('zakat_methods').select('id').eq('code','INDEPENDENT_LOTS').single());
 async function asset(name, type, unit, metadata={}) {
  return value(await client.from('asset_accounts').insert({
   user_id:owner.id, name, asset_type:type, unit, metadata, currency:'SAR',
   ownership_scope:'PERSONAL', is_zakatable:true,
  }).select('id').single()).id;
 }
 async function opening(account, date, quantity, cost) {
  const tx = value(await client.from('transactions').insert({
   user_id:owner.id, asset_account_id:account, transaction_type:'OPENING_BALANCE',
   transaction_date:date, quantity, unit_price:cost/quantity, currency:'SAR',
   base_currency:'SAR', gross_value:cost, base_value:cost, created_by:owner.id,
  }).select('id').single());
  return value(await client.from('lots').insert({
   user_id:owner.id, asset_account_id:account, source_transaction_id:tx.id,
   acquisition_date:date, hawl_start_date:date, original_quantity:quantity,
   remaining_quantity:quantity, original_value_base:cost, remaining_value_base:cost,
  }).select('id').single()).id;
 }
 const bank = await asset(bankName,'BANK','unit');
 const gold = await asset('QA June 18K Gold','GOLD','g',{karat:18});
 const oldCash = await opening(bank,'2025-12-12',1550,1550);
 await opening(gold,'2025-06-12',2,600);
 const remainingGold = await opening(gold,assessDate,8,3200);
 value(await client.rpc('post_sale_with_proceeds',{
  p_user_id:owner.id, p_asset_account_id:gold, p_destination_account_id:bank,
  p_date:assessDate, p_quantity:2, p_sale_value:900, p_currency:'SAR',
  p_base_currency:'SAR', p_base_value:900,
 }));

 const ctx = await context(browser,owner,{width:1440,height:960});
 try {
  const page = await ctx.newPage();
  async function json(response) {
   assert.ok(response.ok(), await response.text());
   return response.json();
  }
  async function get(path) {
   return json(await ctx.request.get(app+path));
  }
  async function clickForPost(path, button) {
   const response = page.waitForResponse(r=>new URL(r.url()).pathname===path && r.request().method()==='POST',{timeout:45000});
   await page.getByRole('button',{name:button,exact:true}).click();
   return response;
  }
  async function bankBalance() {
   return (await get('/api/payments/accounts')).accounts.find(account=>account.id===bank)?.balance;
  }

  assert.equal(await bankBalance(),2450);
  await page.goto(app+'/ar/assessments?scope=PERSONAL',{waitUntil:'domcontentloaded'});
  await page.locator('label').filter({hasText:/^المنهج/}).locator('select').selectOption(method.id);
  await page.getByLabel('تاريخ الاحتساب',{exact:true}).fill(assessDate);
  await page.getByLabel('تاريخ بلوغ المحفظة للنصاب',{exact:true}).fill('2025-06-12');
  await page.getByLabel('سعر الذهب الخالص / g',{exact:true}).fill('400');
  await page.getByLabel('سعر الفضة الخالصة / g',{exact:true}).fill('4');
  const {assessment,lines} = await json(await clickForPost('/api/assessments','إجراء احتساب جديد'));
  assert.equal(Number(assessment.total_zakatable_value),900);
  assert.equal(Number(assessment.zakat_due),22.5);
  assert.equal(lines.length,3);
  for(const [id,due] of [[oldCash,'2026-12-02'],[remainingGold,'2027-06-02']]){
   const line = lines.find(line=>line.lot_id===id);
   assert.equal(Number(line.eligible_value),0);
   assert.equal(line.valuation_snapshot.hawlDueDate,due);
  }
  const inheritedCash = lines.find(line=>Number(line.eligible_value)===900);
  assert.equal(inheritedCash.valuation_snapshot.hawlDueDate,'2026-06-01');
  assert.equal(inheritedCash.valuation_snapshot.receiptComponentPolicy,'SOURCE_PERIOD_V1');

  page.once('dialog',dialog=>dialog.accept());
  await json(await clickForPost('/api/assessments/confirm','اعتماد الاحتساب النهائي'));
  await page.reload({waitUntil:'domcontentloaded'});
  const finalRow = page.getByRole('row').filter({hasText:'FINAL'}).filter({hasText:assessDate});
  await finalRow.getByRole('cell').filter({hasText:/22\.50/}).waitFor();
  await finalRow.scrollIntoViewIfNeeded();
  await page.screenshot({path:'asset-qa-preview/june-zakat-final-ar.png'});

  await page.goto(app+'/ar/payments?scope=PERSONAL',{waitUntil:'domcontentloaded'});
  await page.locator('label').filter({hasText:/^الدورة الزكوية/}).locator('select').selectOption(assessment.hawl_cycle_id);
  await page.locator('label').filter({hasText:/^البنك أو الصندوق المسدد منه/}).locator('select').selectOption(bank);

  const paymentForm = page.locator('section').filter({
   has:page.getByRole('heading',{name:'تسجيل دفعة زكاة',exact:true}),
  });
  await paymentForm.getByLabel('تاريخ السداد',{exact:true}).fill(paymentDate);
  await paymentForm.getByLabel('مبلغ السداد',{exact:true}).fill('22.50');
  const savePayment = paymentForm.getByRole('button',{name:/حفظ/});
  assert.equal(await savePayment.count(),1,JSON.stringify(await paymentForm.getByRole('button').allTextContents()));
  const response = page.waitForResponse(r=>new URL(r.url()).pathname==='/api/payments' && r.request().method()==='POST',{timeout:45000});
  await savePayment.click();
  const paymentResponse = await response;
  const paymentRequest = paymentResponse.request().postDataJSON();
  const payment = await json(paymentResponse);
  assert.equal(payment.payment_date,paymentDate);
  const repeated = await json(await ctx.request.post(app+'/api/payments',{data:paymentRequest}));
  assert.equal(repeated.id,payment.id);

  await page.reload({waitUntil:'domcontentloaded'});
  const paidRow = page.getByRole('row').filter({hasText:paymentDate}).filter({hasText:bankName});
  const number = paidRow.locator('bdi').first();
  await number.waitFor();
  const voucher = await number.innerText();
  assert.match(voucher,/^ZP-/);
  assert.equal(await paidRow.count(),1);
  assert.match(await paidRow.innerText(),/22\.50/);
  await paidRow.scrollIntoViewIfNeeded();
  await page.screenshot({path:'asset-qa-preview/june-zakat-payment-ar.png'});
  const payments = await get('/api/payments');
  assert.equal(payments.length,1);
  assert.equal(payments[0].id,payment.id);
  assert.equal(Number(payments[0].allocated_amount),22.5);
  assert.equal(await bankBalance(),2427.5);
  const movements = value(await client.from('transactions').select('id').eq('asset_account_id',bank).eq('transaction_type','ZAKAT_PAYMENT'));
  assert.equal(movements.length,1);
  const sale = value(await client.from('transactions').select('id')
   .eq('asset_account_id',gold).eq('transaction_type','SALE').single());
  for(const [theme,ink] of [['modern','#27345a'],['elegant','#1a3b32']]){
   const themed=await context(browser,owner,{width:390,height:844},theme);
   try{
    const detail=await themed.newPage();
    for(const [locale,width] of [['ar',390],['en',1440]]){
     await detail.setViewportSize({width,height:960});
     const ar=locale==='ar';
     const workspace=detail.locator(`.corp-shell.theme-${theme} .corp-content`);
     await detail.goto(`${app}/${locale}/assessments/${assessment.id}`);
     await workspace.getByRole('heading',{name:ar?'تفاصيل احتساب الزكاة':'Zakat Assessment',exact:true}).waitFor();
     await detail.goto(`${app}/${locale}/lots/${remainingGold}`);
     await workspace.getByRole('heading',{name:ar?'تفاصيل الدفعة':'Lot Detail',exact:true}).waitFor();
     await detail.goto(`${app}/${locale}/transactions/${sale.id}`);
     await workspace.locator('.operation-detail-card[aria-busy=false] [role=tab]').first().waitFor();
     assert.equal(await workspace.evaluate(node=>getComputedStyle(node).getPropertyValue('--brand-text').trim()),ink);
    }
   }finally{await themed.close();}
  }
  console.log('PASS Modern and Elegant recorded assessment, lot and transaction details');
  console.log('PASS June Zakat browser save, finalize and reload:', voucher, payment.payment_date, 'one SAR 22.50 payment, bank SAR 2450 → 2427.50');
 } finally {
  await ctx.close();
 }
}

let server,browser;
try{
 const owner=await user(),stranger=await user();
 const {id:organization}=value(await owner.client.from('organizations').insert({name:'QA Assets Company',owner_user_id:owner.id}).select('id').single());
 const asset=await seed(owner),companyAsset=await seed(owner,organization),gold18=await seed(owner,null,true);
 server=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','-H','127.0.0.1','-p','3000'],{
  env:{...process.env,NEXT_PUBLIC_SUPABASE_URL:settings.API_URL,NEXT_PUBLIC_SUPABASE_ANON_KEY:settings.ANON_KEY,
   NEXT_PUBLIC_APP_URL:app,NEXT_PUBLIC_APP_ENV:'test',NEXT_PUBLIC_PERSONAL_GOLD_SALES:'1',SUPABASE_SERVICE_ROLE_KEY:'',RESEND_API_KEY:''},stdio:'inherit',
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
 async function statement(ctx,id,date=today(),offset=0,limit=30,impact=false){
  const query=new URLSearchParams({asOf:date,offset:String(offset),limit:String(limit)});
  if(impact)query.set('impact','1');
  const response=await ctx.request.get(app+'/api/assets/'+id+'/statement?'+query);
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

 const profitEndpoint=app+'/api/assets/realized-profit?scope=PERSONAL';
 const profitResponse=await en.request.get(profitEndpoint);
 const profits=await profitResponse.json();
 assert.equal(profitResponse.status(),200,JSON.stringify(profits));
 assert.deepEqual(profits[asset],{status:'recorded',amount:'1150',currency:'SAR'});
 assert.deepEqual(profits[gold18],{status:'recorded',amount:'200',currency:'SAR'});
 const foreignProfits=await foreign.request.get(profitEndpoint);
 assert.equal(foreignProfits.status(),200);
 assert.deepEqual(await foreignProfits.json(),{});

 // Link a real recorded payment voucher. Neither linking nor unlinking posts cash.
 {
  const cash=value(await owner.client.from('asset_accounts').insert({user_id:owner.id,name:'QA selling expense cash',
   asset_type:'BANK',currency:'SAR',ownership_scope:'PERSONAL'}).select('id').single());
  const funding=value(await owner.client.from('transactions').insert({user_id:owner.id,asset_account_id:cash.id,
   transaction_type:'OPENING_BALANCE',transaction_date:'2025-01-01',quantity:500,currency:'SAR',base_currency:'SAR',
   gross_value:500,base_value:500,created_by:owner.id}).select('id').single());
  value(await owner.client.from('lots').insert({user_id:owner.id,asset_account_id:cash.id,source_transaction_id:funding.id,
   acquisition_date:'2025-01-01',original_quantity:500,remaining_quantity:500,original_value_base:500,remaining_value_base:500}));
  const payment=value(await owner.client.rpc('post_withdrawal',{p_user_id:owner.id,p_asset_account_id:cash.id,
   p_date:'2025-03-01',p_quantity:75,p_value:75,p_currency:'SAR',p_base_currency:'SAR',p_base_value:75,p_notes:'QA fixed direct selling fee'}));
  const voucher=value(await owner.client.from('voucher_numbers').select('document_number').eq('source_id',payment)
   .eq('source_table','transactions').single()).document_number;
  const goldSale=value(await owner.client.from('transactions').select('id').eq('asset_account_id',gold18).eq('transaction_type','SALE').single());
  const expensePath=app+'/api/assets/sale-expenses/'+goldSale.id;
  const page=await en.newPage();
  await page.goto(app+'/en/transactions/'+goldSale.id,{waitUntil:'domcontentloaded',timeout:90000});
  await page.getByText('Linked selling expenses',{exact:true}).click();
  await page.getByLabel('Expense voucher number').fill(voucher);
  await page.getByLabel('Reason for linking or unlinking').fill('Documented commission for this gold sale');
  await page.getByRole('button',{name:'Link expense',exact:true}).click();
  await page.getByText('Expense link saved.',{exact:true}).waitFor();
  const linked=await (await en.request.get(expensePath)).json();
  assert.equal(linked.length,1);
  assert.equal(linked[0].source_id,payment);
  assert.equal(Number(linked[0].amount),75);
  assert.deepEqual(await (await foreign.request.get(expensePath)).json(),[]);
  assert.equal((await foreign.request.post(expensePath,{headers:{Origin:app},data:{source:payment,reason:'Foreign account probe'}})).status(),403);
  assert.equal((await (await en.request.get(profitEndpoint)).json())[gold18].amount,'125');
  await page.reload({waitUntil:'domcontentloaded'});
  await page.getByText('Linked selling expenses',{exact:true}).click();
  await page.getByRole('button',{name:'Unlink',exact:true}).click();
  await page.getByLabel('Reason for linking or unlinking').fill('QA release verifies the audited unlink');
  await page.getByRole('button',{name:'Confirm unlink',exact:true}).click();
  await page.getByText('No expenses are linked to this voucher.',{exact:true}).waitFor();
  assert.equal((await (await en.request.get(profitEndpoint)).json())[gold18].amount,'200');
  const balance=value(await owner.client.from('lots').select('remaining_value_base').eq('asset_account_id',cash.id).single());
  assert.equal(Number(balance.remaining_value_base),425);
  await page.close();
 }

 for(const [locale,ctx,customize,label,move,save,close] of [
  ['ar',ar,'تخصيص الجدول','الأرباح الفعلية (المحققة)','تحريك للأعلى','حفظ النموذج والتخصيص','إغلاق'],
  ['en',en,'Customize table','Realized profit / loss','Move up','Save model & customization','Close'],
 ]){
  const page=await ctx.newPage();
  await page.goto(app+'/'+locale+'/assets?scope=PERSONAL',{waitUntil:'domcontentloaded',timeout:90000});
  const goldRow=page.getByRole('row').filter({hasText:'QA 18K Gold'});
  await goldRow.waitFor();
  assert.equal(await page.getByRole('columnheader',{name:label,exact:true}).count(),0);
  await page.getByRole('button',{name:customize,exact:true}).click();
  const options=page.getByRole('dialog');
  const column=options.locator('.att-order-row').filter({hasText:label});
  await column.getByRole('checkbox').check();
  const moveUp=column.getByRole('button',{name:move,exact:true});
  for(let position=await column.evaluate(row=>Array.from(row.parentElement.children).indexOf(row));position>1;position--){
   await moveUp.click();
  }
  await options.getByRole('button',{name:save,exact:true}).click();
  await options.getByRole('button',{name:close,exact:true}).click();
  const cell=goldRow.locator('[data-column="realized"]');
  await cell.locator('.display-money-screen').filter({hasText:/^200\.00 SAR$/}).waitFor();
  const first=await cell.evaluate(node=>node.cellIndex);
  assert.equal(first,1);
  await page.reload({waitUntil:'domcontentloaded'});
  await cell.locator('.display-money-screen').filter({hasText:/^200\.00 SAR$/}).waitFor();
  assert.equal(await cell.evaluate(node=>node.cellIndex),first);
  const heading=page.getByRole('columnheader',{name:label,exact:true}).first();
  await heading.getByRole('button').click();
  assert.equal(await heading.getAttribute('aria-sort'),'ascending');
  await heading.getByRole('button').click();
  assert.equal(await heading.getAttribute('aria-sort'),'descending');
  await page.locator('.asset-report-filters label').filter({hasText:locale==='ar'?'تصفية حسب النوع':'Filter by type'}).locator('select').selectOption('GOLD');
  await cell.scrollIntoViewIfNeeded();
  assert.ok(await cell.evaluate(node=>node.getBoundingClientRect().left>=0&&node.getBoundingClientRect().right<=innerWidth));
  await page.screenshot({path:`asset-qa-preview/realized-profit-${locale}.png`});
  await page.close();
 }

 {
  const page=await en.newPage();
  await page.goto(app+'/en/reports?scope=PERSONAL',{waitUntil:'domcontentloaded',timeout:90000});
  await page.getByRole('row').filter({hasText:'QA 18K Gold'}).locator('.display-money-screen').filter({hasText:/^200\.00 SAR$/}).waitFor();
  await page.getByLabel('Print and export',{exact:true}).click();
  const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'CSV',exact:true}).first().click()]);
  const csv=await readFile(await download.path(),'utf8');
  assert.match(csv,/Realized profit \/ loss/);
  assert.match(csv,/QA 18K Gold[^\n]+200 SAR/);
  assert.match(csv,/QA Gold Statement[^\n]+1150 SAR/);
  await page.close();
 }

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
  await table.locator('tr[data-movement="OPENING_BALANCE"]').getByRole('cell',{name:'300.00',exact:true}).waitFor();
  await table.locator('tr[data-movement="SALE"]').getByRole('cell',{name:'400.00',exact:true}).waitFor();
  assert.equal(await page.getByRole('dialog').count(),1);
  assert.equal(new URL(page.url()).pathname,'/'+locale+'/assets');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1));
  await dialog.getByText('2,460 SAR',{exact:true}).waitFor({timeout:20000});
  await dialog.getByText('307.5 SAR',{exact:true}).waitFor({timeout:20000});
  await dialog.locator('[data-asset-movement="OPENING_BALANCE"] > summary').click();
  await dialog.getByText(new RegExp('10 .* × 300 = 3,000 SAR')).waitFor({timeout:20000});
  await dialog.locator('[data-asset-movement="SALE"] > summary').click();
  await dialog.getByText(new RegExp('2 .* × 400 = 800 SAR')).waitFor({timeout:20000});
  await dialog.getByRole('region',{name:locale==='ar'?'ملخص رصيد الأصل':'Asset balance summary'}).getByText('200 SAR',{exact:true}).waitFor({timeout:20000});
  const download=page.waitForEvent('download');
  await dialog.getByRole('button',{name:locale==='ar'?'تصدير كشف الحركة CSV':'Export movement statement CSV',exact:true}).click();
  const csv=await (await download).createReadStream();
  let contents='';
  for await(const chunk of csv)contents+=chunk.toString('utf8');
  assert.ok(contents.includes('"800"')&&contents.includes('"2400"'));
  assert.ok(contents.includes(gold.payload.rows.find(row=>row.type==='SALE').voucher));
  const popup=page.waitForEvent('popup');
  await dialog.getByRole('button',{name:locale==='ar'?'طباعة كشف الحركة':'Print movement statement',exact:true}).click();
  const print=await popup;
  const printedSale=print.getByRole('row').filter({hasText:gold.payload.rows.find(row=>row.type==='SALE').voucher});
  const printedProceeds=printedSale.getByRole('cell').nth(11);
  await printedProceeds.waitFor();
  assert.equal(await printedProceeds.textContent(),'800');
  assert.equal(await printedSale.getByRole('cell').nth(6).textContent(),'400.00');
  assert.equal(await print.locator('html').getAttribute('dir'),locale==='ar'?'rtl':'ltr');
  await print.close();
  await page.screenshot({path:`asset-qa-preview/statement-${locale}.png`});
 }
 // Verify direction, same-card navigation and recorded cash on all language/layout combinations.
 for(const locale of ['ar','en'])for(const viewport of [{width:390,height:844},{width:1440,height:960}]){
  const arabic=locale==='ar';
  const ctx=await context(browser,owner,viewport);
  const page=await ctx.newPage();
  await page.goto(app+'/'+locale+'/assets?scope=PERSONAL',{waitUntil:'domcontentloaded'});
  const trigger=page.getByRole('row').filter({hasText:'QA 18K Gold'}).getByRole('button',{
   name:arabic?'التفاصيل والإجراءات':'Details and actions',exact:true,
  });
  await trigger.click();
  const dialog=page.getByRole('dialog');
  const original=await dialog.boundingBox();
  await dialog.getByRole('button',{name:arabic?'أثر العمليات على الزكاة':'Zakat impact of operations',exact:true}).click();
  const impact=dialog.getByRole('region',{name:arabic?'أثر العمليات على الزكاة':'Zakat impact of operations'});
  await impact.getByText('QA Gold Proceeds',{exact:true}).waitFor({timeout:20000});
  await impact.locator('li > span').getByText('800 SAR',{exact:true}).waitFor();
  await impact.locator('.asset-card-hawl-sources').getByText('800 SAR',{exact:true}).waitFor();
  await impact.getByText(arabic?'لا يوجد حول موروث مسجّل لهذه الدفعة':
   'No inherited Hawl is recorded for this lot').waitFor();
  assert.equal(await page.getByRole('dialog').count(),1);
  const moved=await dialog.boundingBox();
  assert.deepEqual([moved.x,moved.y,moved.width],[original.x,original.y,original.width]);
  assert.equal(await dialog.locator('.asset-card').getAttribute('dir'),arabic?'rtl':'ltr');
  await dialog.getByRole('button',{name:arabic?'كشف حركة الأصل':'Asset movement statement',exact:true}).click();
  const table=dialog.getByRole('table');
  await table.getByText('2400',{exact:true}).first().waitFor();
  assert.equal(await table.evaluate(el=>el.parentElement.scrollWidth>=el.offsetWidth),true);
  assert.equal(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);
  await page.screenshot({path:`asset-qa-preview/card-${locale}-${viewport.width}.png`});
  await page.keyboard.press('Escape');
  assert.equal(await dialog.count(),0);
  assert.equal(await trigger.evaluate(el=>document.activeElement===el),true);
  await ctx.close();
 }
 for(const [theme,headerColor,tabColor] of [
  ['modern','rgb(41, 60, 143)','rgb(67, 85, 199)'],
  ['elegant','rgb(25, 77, 66)','rgb(13, 117, 95)'],
 ])for(const locale of ['ar','en'])for(const width of [390,1440]){
  const ctx=await context(browser,owner,{width,height:960},theme);
  try{
   const page=await ctx.newPage();
   await page.goto(app+'/'+locale+'/assets?scope=PERSONAL',{waitUntil:'domcontentloaded'});
   const workspace=page.locator(`.corp-shell.theme-${theme}`);
   await workspace.getByRole('row').filter({hasText:'QA 18K Gold'}).getByRole('button',{
    name:locale==='ar'?'التفاصيل والإجراءات':'Details and actions',exact:true,
   }).click();
   const card=workspace.locator('.asset-card-dialog');
   const colors=await card.evaluate(dialog=>{
    const header=dialog.querySelector('.asset-card-header');
    const tab=dialog.querySelector('.asset-card-tabs button[aria-pressed=true]');
    return {
     header:getComputedStyle(header).backgroundColor,
     heading:getComputedStyle(header.querySelector('h2')).color,
     tab:getComputedStyle(tab).backgroundColor,
     tabText:getComputedStyle(tab).color,
    };
   });
   assert.deepEqual(colors,{header:headerColor,heading:'rgb(255, 255, 255)',tab:tabColor,tabText:'rgb(255, 255, 255)'});
   assert.ok(await card.evaluate(dialog=>dialog.scrollWidth<=dialog.clientWidth+1));
   await page.screenshot({path:`asset-qa-preview/card-${theme}-${locale}-${width}.png`});
  }finally{await ctx.close();}
 }
 // Save a new personal sale inside the card and reconcile the asset and its single receipt.
 {
  const personal=await seed(owner,null,true,'QA Card Sale');
  const bank=value(await owner.client.from('asset_accounts').insert({user_id:owner.id,
   name:'QA destination for in-card sale',asset_type:'BANK',currency:'SAR',ownership_scope:'PERSONAL'}).select('id').single());
  const page=await en.newPage();
  const dialog=page.getByRole('dialog');
  const open=()=>page.getByRole('row').filter({hasText:'QA Card Sale'}).getByRole('button',{name:'Details and actions',exact:true}).click();
  await page.goto(app+'/en/assets?scope=PERSONAL');
  await open();
  await dialog.getByRole('button',{name:'Sell',exact:true}).click();
  await dialog.getByLabel('Quantity',{exact:true}).fill('2');
  await dialog.getByLabel('Sale price per unit').fill('450');
  await dialog.getByLabel('Proceeds account').selectOption(bank.id);
  let command,first;
  const url=app+'/api/transactions';
  await page.route(url,async route=>{
   if(route.request().method()!=='POST'){await route.continue();return;}
   command=route.request().postDataJSON();
   assert.ok(command.request_id);
   const [initial,concurrent]=await Promise.all([route.fetch(),en.request.post(url,{data:command})]);
   assert.equal(initial.status(),201,await initial.text());
   assert.equal(concurrent.status(),201,await concurrent.text());
   first=await initial.json();
   assert.deepEqual(await concurrent.json(),first);
   await route.abort();
  });
  await dialog.getByRole('button',{name:'Save operation',exact:true}).click();
  await dialog.getByRole('alert').getByText(/save outcome is uncertain/i).waitFor();
  await page.unroute(url);
  await page.reload();
  await open();
  await dialog.getByRole('button',{name:'Sell',exact:true}).click();
  const saved=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname==='/api/transactions');
  await dialog.getByRole('button',{name:'Retry same request',exact:true}).click();
  const response=await saved;
  assert.equal(response.status(),201,await response.text());
  const result=await response.json();
  assert.equal(response.request().postDataJSON().request_id,command.request_id);
  assert.deepEqual(result,first);
  await dialog.getByRole('region',{name:'Asset balance summary'}).getByText('1,800 SAR',{exact:true}).waitFor();
  assert.equal(await page.getByRole('dialog').count(),1);
  assert.equal(new URL(page.url()).pathname,'/en/assets');
  const operations=value(await owner.client.from('transactions').select('id,asset_account_id,base_value').eq('transfer_id',result.transfer_id));
  assert.equal(operations.length,2);
  assert.equal(Number(operations.find(row=>row.asset_account_id===bank.id).base_value),900);
  await page.reload();
  await open();
  await dialog.getByText('Asset movement statement',{exact:true}).click();
  await dialog.getByRole('region',{name:'Asset balance summary'}).getByText('1,800 SAR',{exact:true}).waitFor();
  const persisted=(await statement(en,personal)).payload;
  assert.deepEqual(persisted.closing,{quantity:'6',cost:'1800',currency:'SAR'});
  assert.deepEqual(persisted.rows.find(row=>row.source_id===result.sale_transaction_id).sale,
   {proceeds:'900',cost:'600',realized:'300'});
  const conflict=await en.request.post(url,{data:{...command,unit_price:451}});
  assert.equal(conflict.status(),400);
  assert.deepEqual(await conflict.json(),{error:'PERSONAL_ASSET_EXIT_REQUEST_CONFLICT'});
  const saleAudit=value(await owner.client.from('audit_logs').select('id').eq('entity_id',result.sale_transaction_id).eq('action','CREATE'));
  assert.equal(saleAudit.length,1);
  const bankMovements=value(await owner.client.from('transactions').select('id').eq('asset_account_id',bank.id));
  assert.deepEqual(bankMovements,[{id:result.proceeds_transaction_id}]);
  const affectedSales=value(await owner.client.from('transactions').select('id').eq('asset_account_id',personal).eq('transaction_type','SALE'));
  assert.equal(affectedSales.length,2); // Seed sale plus this command.

  // Discard a response to a full disposal. The exited asset must still offer recovery.
  await dialog.getByRole('button',{name:'Asset summary',exact:true}).click();
  await dialog.getByRole('button',{name:'Dispose',exact:true}).click();
  assert.equal(await dialog.getByRole('combobox',{name:/^Action/}).inputValue(),'DISPOSAL');
  await dialog.getByLabel('Quantity',{exact:true}).fill('6');
  let disposalId;
  await page.route(url,async route=>{
   if(route.request().method()!=='POST'){await route.continue();return;}
   const disposal=await route.fetch();
   assert.equal(disposal.status(),201,await disposal.text());
   disposalId=await disposal.json();
   await route.abort();
  });
  await dialog.getByRole('button',{name:'Save operation',exact:true}).click();
  await dialog.getByRole('alert').getByText(/save outcome is uncertain/i).waitFor();
  await page.unroute(url);
  await page.reload();
  await page.locator('.asset-lifecycle-tabs').getByRole('button',{name:'All',exact:true}).click();
  await open();
  await dialog.getByRole('button',{name:'Dispose',exact:true}).click();
  const repeated=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname==='/api/transactions');
  await dialog.getByRole('button',{name:'Retry same request',exact:true}).click();
  const disposalReplay=await repeated;
  assert.equal(disposalReplay.status(),201,await disposalReplay.text());
  assert.equal(await disposalReplay.json(),disposalId);
  const disposed=(await statement(en,personal)).payload;
  assert.deepEqual(disposed.closing,{quantity:'0',cost:'0',currency:'SAR'});
  assert.equal(disposed.rows.filter(row=>row.type==='DISPOSAL').length,1);
  const disposalAudit=value(await owner.client.from('audit_logs').select('id').eq('entity_id',disposalId).eq('action','CREATE'));
  assert.equal(disposalAudit.length,1);
  assert.deepEqual(value(await owner.client.from('transactions').select('id').eq('asset_account_id',bank.id)),bankMovements);
  console.log('Personal exit replay: one sale, 900 SAR receipt and one audit after concurrent requests and reload; full disposal replay has one voucher and no proceeds.');

 }
 // Correct the independent sale after the destination asset's existing history.
 {
  const page=await en.newPage();
  const open=async name=>{
   await page.getByRole('row').filter({hasText:name}).getByRole('button',{name:'Details and actions',exact:true}).click();
  };
  const bank=value(await owner.client.from('asset_accounts').insert({user_id:owner.id,
   name:'QA corrected proceeds',asset_type:'BANK',unit:'SAR',currency:'SAR',ownership_scope:'PERSONAL'}).select('id').single());
  await page.goto(app+'/en/assets?scope=PERSONAL');
  await open('QA 18K Gold');
  const sourceDialog=page.getByRole('dialog');
  const cardValue=(label,amount)=>sourceDialog.getByRole('region',{name:'Asset balance summary'}).locator('.asset-card-kpi').filter({
   has:page.getByText(label,{exact:true}),
  }).getByText(amount,{exact:true});
  await cardValue('Remaining quantity','8 g').waitFor();
  await cardValue('Remaining cost','2,400 SAR').waitFor();
  await sourceDialog.getByRole('button',{name:'Asset movement statement',exact:true}).click();
  await sourceDialog.getByRole('table').getByRole('button',{name:gold.payload.rows.find(r=>r.type==='SALE').voucher,exact:true}).click();
  await page.getByRole('button',{name:'Review sale correction'}).click();
  await page.getByLabel('Correction type').selectOption('structure');
  await page.getByRole('combobox',{name:/^Sold asset/}).selectOption(asset);
  await page.getByLabel('Sale date').fill('2025-05-01');
  await page.getByRole('combobox',{name:/^Proceeds account/}).selectOption(bank.id);
  await page.getByLabel('Quantity',{exact:true}).fill('3');
  await page.getByLabel('Unit price').fill('450');
  await page.getByLabel('Correction reason').fill('Independent destination sale history');
  const saved=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().includes('/api/transactions/')&&r.request().postDataJSON()?.action==='correct-sale');
  await page.getByRole('button',{name:'Save correction'}).click();
  const response=await saved;assert.ok(response.ok(),await response.text());
  const replacement=await response.json();
  await page.getByText('Asset movement statement',{exact:true}).waitFor();
  await sourceDialog.getByRole('region',{name:'Asset balance summary'}).getByText('3,000 SAR',{exact:true}).waitFor();
  await sourceDialog.getByRole('button',{name:'Asset summary',exact:true}).click();
  await cardValue('Remaining quantity','10 g').waitFor();
  await cardValue('Remaining cost','3,000 SAR').waitFor();
  assert.equal(await page.getByRole('dialog').count(),1);
  assert.equal(new URL(page.url()).pathname,'/en/assets');
  await page.reload();await open('QA Gold Statement');
  await sourceDialog.getByRole('button',{name:'Asset movement statement',exact:true}).click();
  const current=(await statement(en,asset)).payload;
  const row=current.rows.find(r=>r.source_id===replacement.id);
  assert.ok(row.voucher);assert.equal(row.amount,'1350');assert.equal(row.sale.cost,'960');
  await page.getByRole('dialog').getByRole('button',{name:row.voucher,exact:true}).waitFor();
  assert.equal((await statement(en,gold18)).payload.closing.quantity,'10');
  const cash=value(await owner.client.from('lots').select('remaining_quantity').eq('asset_account_id',bank.id));
  assert.deepEqual(cash.map(l=>Number(l.remaining_quantity)),[1350]);
  console.log('Independent corrected voucher',row.voucher,'proceeds 1350, cost 960, gain 390');
  await page.close();
 }
 for(const locale of ['ar','en']){
  const account=await user(), arabic=locale==='ar';
  const ctx=await context(browser,account,arabic?{width:390,height:844}:{width:1440,height:960});
  const sources=[], sourceLots=[];
  const hawlDates=['2024-06-11','2024-11-12'];
  for(const [name,quantity,cost,date] of [['Alpha',4,1200,'2025-01-01'],['Beta',6,2040,'2025-02-01']]){
   const asset=value(await account.client.from('asset_accounts').insert({user_id:account.id,name,asset_type:'GOLD',currency:'SAR',unit:'g',ownership_scope:'PERSONAL',metadata:{karat:18}}).select('id').single());
   const tx=value(await account.client.from('transactions').insert({user_id:account.id,asset_account_id:asset.id,transaction_type:'OPENING_BALANCE',transaction_date:date,quantity,currency:'SAR',base_currency:'SAR',base_value:cost,gross_value:cost,created_by:account.id}).select('id').single());
   const lot=value(await account.client.from('lots').insert({
    user_id:account.id,asset_account_id:asset.id,source_transaction_id:tx.id,acquisition_date:date,
    hawl_start_date:hawlDates[sources.length],original_quantity:quantity,remaining_quantity:quantity,
    original_value_base:cost,remaining_value_base:cost,
   }).select('id').single());
   sources.push(asset.id);
   sourceLots.push(lot.id);
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
  const selectedQuantities=arabic?[1,5]:[4,2];
  async function reconcileReceipt(unitPrice){
   const result=await Promise.all(sources.map(id=>statement(ctx,id,today(),0,30,true)));
   for(const [i,{status,payload}] of result.entries()){
    assert.equal(status,200,JSON.stringify(payload));
    assert.equal(payload.reconciliation,'MATCHED');
    const receipt=payload.rows.find(r=>r.voucher===number).cashImpact.receipt;
    assert.deepEqual(receipt.inheritedHawlDates,[hawlDates[i]]);
    assert.deepEqual(receipt.sources.map(source=>({
     id:source.lotId,quantity:Number(source.quantity),proceeds:Number(source.proceeds),
    })),[{id:sourceLots[i],quantity:selectedQuantities[i],proceeds:selectedQuantities[i]*unitPrice}]);
   }
  }
  for(const [i,id] of sources.entries()){
   const current=(await statement(ctx,id)).payload;
   assert.equal(current.reconciliation,'MATCHED');
   assert.equal(current.rows.find(r=>r.voucher===number).sale.realized,String((arabic?[100,300]:[400,120])[i]));
  }
  await reconcileReceipt(400);
  assert.deepEqual(value(await stranger.client.rpc('personal_gold_receipt_hawl_sources',{
   p_receipt_id:sale.proceeds_transaction_id,
  })),[]);
  assert.equal(value(await account.client.from('lots').select('remaining_quantity').eq('asset_account_id',bank.id)).length,1);
  const impactLabel=arabic?'أثر العمليات على الزكاة':'Zakat impact of operations';
  const impactPanel=page.getByRole('region',{name:impactLabel});
  const shownAsset=arabic?0:1;
  await page.getByRole('dialog').getByRole('button',{name:impactLabel,exact:true}).click();
  const sourcesShown=impactPanel.locator('.asset-card-hawl-sources');
  await sourcesShown.getByText(hawlDates[shownAsset],{exact:true}).waitFor();
  assert.equal(await sourcesShown.getByText(hawlDates[1-shownAsset],{exact:true}).count(),0);
  await sourcesShown.getByText(arabic?'400 SAR':'800 SAR',{exact:true}).waitFor();
  await page.screenshot({path:'asset-qa-preview/grouped-hawl-'+locale+'.png'});
  await page.getByRole('dialog').getByRole('button',{
   name:arabic?'كشف حركة الأصل':'Asset movement statement',exact:true,
  }).click();
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
   await reconcileReceipt(price);
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
   const current=(await statement(ctx,id,today(),0,30,true)).payload;
   assert.equal(current.reconciliation,'MATCHED');
   assert.equal(current.closing.cost,String([1200,2040][i]));
   assert.ok(current.rows.every(row=>row.source_id!==sale.sale_transaction_id||row.cashImpact==null));
  }
  console.log('GROUPED_HAWL',locale,JSON.stringify({hawlDates,selectedQuantities,proceeds:selectedQuantities.map(q=>q*400)}));
  console.log('GROUPED_REVERSAL',locale,JSON.stringify(accepted));
  await ctx.close();
 }
 console.log('PASS scoped opening and FIFO statement; 9 units / 2840 as of first sale, 6 / 1920 today, corporate 10 / 90000, denied cross-user and organization, AR mobile and EN desktop');
 await verifySavedAssessmentMethod(browser);
 await verifyFirstNisabCycle(browser);
 await verifyJuneZakatPayment(browser);
}finally{
 await browser?.close();
 server?.kill();
}
