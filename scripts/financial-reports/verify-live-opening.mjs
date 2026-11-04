// Full canonical schema, genuine Auth/PostgREST and actual Next/browser. Loopback only.
import {execFileSync,spawn} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile,mkdir,writeFile,open} from 'node:fs/promises';
import {createClient} from '@supabase/supabase-js';
import {createServerClient} from '@supabase/ssr';
import assert from 'node:assert/strict';
const dir=process.env.OPENING_QA_WORKDIR;
assert.ok(dir&&process.env.RUNNER_TEMP&&dir.startsWith(process.env.RUNNER_TEMP+'/'),'DISPOSABLE_RUNNER_REQUIRED');
const status=JSON.parse(execFileSync('npx',['--yes','supabase@2.122.0','status','--workdir',dir,'--output','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
assert.equal(status.API_URL,'http://127.0.0.1:54321');
const url=status.API_URL,app='http://localhost:3200',out='docs/financial-reports/evidence-opening-live';
const sql=input=>execFileSync('docker',['exec','-i','supabase_db_opening-workspace-qa','psql','-X','-q','-t','-A','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres'],{input,encoding:'utf8',maxBuffer:8*1024*1024,stdio:['pipe','pipe','pipe']}).trim();
const checks=[],errors=[],report={engine:'Full canonical migrations + real Supabase Auth/PostgREST + Next + Chromium',remoteConnections:false,checks};
let server,browser;
const check=async(name,run)=>{await run();checks.push({name,status:'passed'});console.log('PASS '+name)};
await mkdir(out,{recursive:true});
try{
 await writeFile(out+'/catalog.json',sql('select coalesce(jsonb_agg(t),\'[]\') from ('+(await readFile('tests/migration-history/catalog.sql','utf8')).replace(/;\s*$/,'')+') t')+'\n');
 for(const file of ['qa-financial-opening-workspace.sql','qa-financial-opening-ledger.sql','qa-financial-opening-sources.sql','qa-financial-opening-first-activity.sql','qa-financial-opening-general-fiscal.sql'])await check('Actual PostgreSQL '+file,async()=>{const result=sql(await readFile('tests/'+file,'utf8'));await writeFile(out+'/'+file.replace('.sql','.json'),result+'\n');const parsed=JSON.parse(result),rows=Array.isArray(parsed)?parsed:parsed.checks;assert.ok(rows.length>0);assert.ok(rows.every(r=>r.passed===true))});
 const actors=[];
 for(let i=0;i<3;i++){const client=createClient(url,status.ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}}),email=`opening-${i}@local.test`,password=randomBytes(24).toString('base64url')+'Aa7!';const r=await client.auth.signUp({email,password});assert.ifError(r.error);assert.ok(r.data.session);actors.push({client,email,password,id:r.data.user.id})}
 const[a,b,viewer]=actors,org='b1000000-0000-4000-8000-000000000001',other='b1000000-0000-4000-8000-000000000002',cash='b2000000-0000-4000-8000-000000000001',customer='b3000000-0000-4000-8000-000000000001';
 sql(`select set_config('request.jwt.claim.sub','${a.id}',false);
 insert into public.organizations(id,owner_user_id,name) values('${org}','${a.id}','Opening test A');
 select set_config('request.jwt.claim.sub','${b.id}',false);
 insert into public.organizations(id,owner_user_id,name) values('${other}','${b.id}','Opening test B');
 select set_config('request.jwt.claim.sub','${a.id}',false);
 insert into public.organization_members(organization_id,user_id,role,status) values('${org}','${a.id}','OWNER','ACTIVE'),('${other}','${b.id}','OWNER','ACTIVE'),('${org}','${viewer.id}','VIEWER','ACTIVE') on conflict(organization_id,user_id) do update set role=excluded.role,status='ACTIVE';
 insert into public.liquidity_accounts(id,organization_id,name,account_type,currency,current_balance,current_balance_base,created_by,metadata) values('${cash}','${org}','الحساب البنكي الرئيسي','BANK','SAR',500,500,'${a.id}','{"opening_date":"2025-12-31","opening_balance":500,"opening_fx_rate":1}');
 insert into public.liquidity_counterparties(id,organization_id,name,party_type,created_by) values('${customer}','${org}','عميل بلا رصيد افتتاحي','CUSTOMER','${a.id}');`);
 sql(`insert into public.financial_fiscal_calendars(organization_id,start_month,start_day,retained_earnings_account,updated_by) values('${org}',1,1,'3300','${a.id}'),('${other}',1,1,'3300','${b.id}');`);
 const scope={p_org:org,p_fiscal_start:'2026-01-01'};
 await check('Real user sessions isolate opening source reads and reject forged metadata',async()=>{assert.ifError((await a.client.rpc('financial_opening_workspace',scope)).error);assert.ok((await b.client.rpc('financial_opening_workspace',scope)).error);assert.ifError((await viewer.client.auth.updateUser({data:{role:'OWNER',financial_core:{approve:true}}})).error);assert.ok((await viewer.client.rpc('save_financial_opening',{...scope,p_expected_version:0,p_source_revision:'x',p_entries:{},p_reason:''})).error)});
 const cookies=[],ssr=createServerClient(url,status.ANON_KEY,{cookies:{getAll:()=>cookies,setAll:cs=>{for(const c of cs){const i=cookies.findIndex(x=>x.name===c.name);if(i>=0)cookies.splice(i,1);cookies.push(c)}}}});assert.ifError((await ssr.auth.signInWithPassword({email:a.email,password:a.password})).error);
 const env={...process.env,NEXT_PUBLIC_SUPABASE_URL:url,NEXT_PUBLIC_SUPABASE_ANON_KEY:status.ANON_KEY,NEXT_PUBLIC_APP_URL:app,FINANCIAL_OPENING_WORKSPACE:'true',FINANCIAL_STATEMENTS_LIVE:'true',VERCEL_ENV:'preview'};
 const build=spawn('npm',['run','build'],{env,stdio:'inherit'});assert.equal(await new Promise(resolve=>build.on('exit',resolve)),0);
 const log=await open(out+'/next.log','w');server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3200'],{env,stdio:['ignore',log.fd,log.fd]});
 for(let i=0;i<180;i++){try{if((await fetch(app+'/api/financial-reporting/openings?action=context')).status===401)break}catch{}await new Promise(r=>setTimeout(r,500));if(i===179)throw Error('NEXT_START_TIMEOUT')}
 const{chromium}=await import(process.env.FINANCIAL_SOURCE_BROWSER_MODULE);browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1672,height:941},acceptDownloads:true});await context.addCookies(cookies.map(c=>({name:c.name,value:c.value,domain:'localhost',path:'/',httpOnly:false,secure:false,sameSite:'Lax'})));const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await check('An authorized organization without an approved opening exposes its three in-year vouchers',async()=>{
  sql(`insert into public.organization_members(organization_id,user_id,role,status) values('${other}','${a.id}','OWNER','ACTIVE');
   do $$ declare asset uuid; d date; begin
    perform set_config('request.jwt.claim.sub','${b.id}',true);
    insert into public.liquidity_accounts(organization_id,name,account_type,currency,current_balance,current_balance_base,created_by,metadata)
     values('${other}','September QA bank','BANK','SAR',250000,250000,'${b.id}','{"opening_date":"2026-09-28","opening_balance":250000}');
    foreach d in array array[date '2026-01-01',date '2026-10-21',date '2026-10-23'] loop
     insert into public.asset_accounts(user_id,organization_id,ownership_scope,asset_type,name,currency,metadata)
      values('${b.id}','${other}','ORGANIZATION','OTHER','Opening QA '||d,'SAR','{"acquisition_mode":"OPENING_BALANCE"}') returning id into asset;
     insert into public.transactions(user_id,organization_id,asset_account_id,transaction_type,transaction_date,quantity,currency,base_currency,base_value,gross_value,metadata)
      values('${b.id}','${other}',asset,'OPENING_BALANCE',d,1,'SAR','SAR',100,100,'{}');
    end loop;
   end $$;`);
  await page.goto(app+'/en/financial-reports?screen=kpis&organization='+org);
  const picker=page.getByRole('combobox',{name:'Organization',exact:true});
  await picker.locator('option[value="'+other+'|"]').waitFor({state:'attached'});
  assert.equal(await picker.isEnabled(),true);await picker.selectOption(other+'|');
  await page.getByRole('heading',{name:'Organization registers',exact:true}).waitFor();
  const registerRow=page.getByRole('row').filter({has:page.getByRole('rowheader',{name:'September QA bank'})});
  await registerRow.waitFor();assert.match(await registerRow.innerText(),/250,000.00/);
  await page.getByRole('link',{name:'Opening balances and vouchers'}).click();
  await page.getByRole('tab',{name:/Assets & depreciation/}).click();
  const vouchers=page.locator('[data-period-voucher]');
  await vouchers.first().waitFor();assert.equal(await vouchers.count(),2);
  for(const date of ['2026-10-21','2026-10-23'])assert.match(await vouchers.allTextContents().then(v=>v.join(' ')),new RegExp(date));
  const dataFor=async fiscalStart=>{
   const response=await page.request.get(app+'/api/financial-reporting/openings?'+new URLSearchParams({organization:other,fiscalStart}));
   assert.equal(response.status(),200);return response.json();
  };
  const current=await dataFor('2026-01-01'),next=await dataFor('2027-01-01');
  for(const voucher of current.periodAssetOpenings){
   const id='asset:'+voucher.assetId;
   assert.equal(current.source.rows.find(row=>row.id===id).vouchers.length,voucher.date==='2026-01-01'?1:0);
   const carried=next.source.rows.find(row=>row.id===id).vouchers;
   assert.equal(carried.length,1);assert.equal(Number(carried[0].debit),Number(voucher.amount));
  }
  assert.equal(next.periodAssetOpenings.length,0);
  const bank=current.source.rows.find(row=>row.ar==='September QA bank');
  assert.equal(bank.vouchers.length,0);assert.equal(Number(current.bankRegister[bank.id].balance),250000);
  assert.equal(Number(next.source.rows.find(row=>row.id===bank.id).vouchers[0].debit),250000);
  sql(`update public.organization_members set status='INACTIVE' where organization_id='${other}' and user_id='${a.id}'`);
 });
 await check('An ordinary browser user declares a late bank opening without technical IDs or copying its current balance',async()=>{
  await page.goto(app+'/en/opening-balances?organization='+other);await page.locator('[data-opening-ready="'+other+'"]').waitFor();
  await page.getByText('Assign late opening sources',{exact:true}).click();
  const picker=page.getByRole('combobox',{name:'Opening source',exact:true});
  const option=picker.locator('option').filter({hasText:'September QA bank'});await option.waitFor({state:'attached'});await picker.selectOption(await option.getAttribute('value'));
  await page.getByLabel('Bank opening in base currency',{exact:true}).fill('0');await page.getByLabel('Opening assignment reason',{exact:true}).fill('New bank existed only after the beginning of this year');
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.setViewportSize({width:1672,height:941});
  const assigned=page.waitForResponse(r=>r.url().endsWith('/api/financial-reporting/fiscal')&&r.request().method()==='POST');await page.getByRole('button',{name:'Confirm source assignment',exact:true}).click();assert.equal((await assigned).status(),200);
  const fresh=await a.client.rpc('financial_opening_workspace',{p_org:other,p_fiscal_start:'2026-01-01'});assert.ifError(fresh.error);
  const bank=fresh.data.source.rows.find(row=>row.en==='September QA bank');assert.equal(bank.vouchers[0].debit,'0.0000');assert.equal(Number(fresh.data.bankRegister[bank.id].balance),250000);
  assert.equal(bank.vouchers[0].effectiveDate,'2026-01-01');assert.equal(bank.vouchers[0].transactionDate,'2026-09-28');
 });
 await check('Connected opening page loads actual master names and missing states',async()=>{await page.goto(app+'/ar/opening-balances');await page.locator('[data-opening-ready="'+org+'"]').waitFor();await page.getByText('عميل بلا رصيد افتتاحي',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'اعتماد الأرصدة',exact:true}).isDisabled(),true);await page.screenshot({path:out+'/opening-ar-desktop-before.png',fullPage:true})});
 await check('Cash row shows current register value independently of fiscal opening',async()=>{
  await page.locator('#ob-tab-cash').click();
  const row=page.locator('[data-opening-row="cash:'+cash+'"]');
  assert.equal(await row.getAttribute('data-final'),'500.0000');
  assert.match(await row.locator('td[data-label="رصيد السجل الحالي"]').innerText(),/500.00 SAR/);
  await page.locator('#ob-tab-customers').click();
 });
 await check('Persisted draft distinguishes confirmed zero, reopens after refresh, and approves',async()=>{
  await page.getByRole('button',{name:'تأكيد رصيد صفري',exact:true}).click();await page.getByRole('tab',{name:/^حقوق الملكية/}).click();
  await page.getByLabel('الإضافة: رأس المال',{exact:true}).fill('500');for(const name of ['الاحتياطيات','الأرباح المحتجزة'])await page.locator('tr').filter({has:page.getByLabel('الإضافة: '+name,{exact:true})}).getByRole('button',{name:'تأكيد رصيد صفري',exact:true}).click();
  for(const tab of ['customers','suppliers','cash','assets','loans','advances','other','equity']){
   await page.locator('#ob-tab-'+tab).click();
   const zero=page.getByRole('button',{name:'تأكيد رصيد صفري',exact:true});
   while(await zero.count())await zero.first().click();
  }
  const saved=page.waitForResponse(r=>r.url().endsWith('/api/financial-reporting/openings')&&r.request().method()==='POST');await page.getByRole('button',{name:'حفظ المسودة',exact:true}).click();const savedResponse=await saved;assert.equal(savedResponse.status(),200,JSON.stringify(await savedResponse.json()));await page.locator('[data-opening-ready="'+org+'"]').waitFor();await page.reload();await page.locator('[data-opening-ready="'+org+'"]').waitFor();await page.getByRole('tab',{name:/^حقوق الملكية/}).click();assert.equal(await page.getByLabel('الإضافة: رأس المال',{exact:true}).inputValue(),'500');
  const approved=page.waitForResponse(r=>r.url().endsWith('/api/financial-reporting/openings')&&r.request().method()==='POST');await page.getByRole('button',{name:'اعتماد الأرصدة',exact:true}).click();const approvedResponse=await approved;assert.equal(approvedResponse.status(),200,JSON.stringify(await approvedResponse.json()));await page.getByText(/معتمد ·/).waitFor();await page.getByRole('tab',{name:/^حقوق الملكية/}).click();assert.equal(await page.getByLabel('الإضافة: رأس المال',{exact:true}).isDisabled(),true);
  const read=await a.client.rpc('financial_opening_workspace',scope);assert.ifError(read.error);assert.equal(read.data.workspace.status,'APPROVED');assert.equal(read.data.workspace.entries['equity:3100'].amount,'500');
 });
 await check('Browser Excel export preserves actual source marker, source amount and final opening',async()=>{const d=page.waitForEvent('download');await page.getByRole('button',{name:'تصدير Excel',exact:true}).click();const file=await d;await file.saveAs(out+'/opening-approved.xlsx');const{default:ExcelJS}=await import('exceljs'),book=new ExcelJS.Workbook();await book.xlsx.readFile(await file.path());assert.equal(book.worksheets.length,2);assert.match(String(book.worksheets[1].getCell('A1').value),/LIVE REGISTERS/);assert.ok(book.worksheets[1].rowCount>=7)});
 await check('Posting policy UI saves and approves a real initial policy',async()=>{await page.goto(app+'/ar/financial-reporting-policy');await page.getByRole('heading',{name:'قواعد ترحيل القوائم المالية'}).waitFor();await page.getByLabel('سبب الإعداد أو التغيير').fill('إعداد قواعد المرحلة الافتتاحية');await page.getByRole('button',{name:'حفظ المسودة',exact:true}).click();await page.getByRole('button',{name:'اعتماد القواعد',exact:true}).click();await page.getByRole('button',{name:'إعداد نسخة جديدة',exact:true}).waitFor();const r=await a.client.rpc('financial_statement_live_snapshot',{p_org:org,p_from:'2026-01-01',p_to:'2026-12-31'});assert.ifError(r.error);assert.equal(r.data.origin,'LIVE_CANONICAL_EVENTS')});
 for(const lang of ['ar','en'])for(const width of [1672,390])await check('Actual approved page layout '+lang+' '+width,async()=>{await page.setViewportSize({width,height:width===390?844:941});await page.goto(app+'/'+lang+'/opening-balances');await page.locator('[data-opening-ready="'+org+'"]').waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:out+`/opening-${lang}-${width}.png`,fullPage:true});await page.goto(app+'/'+lang+'/financial-reports');await page.locator('[data-statement-ready="overview"]').waitFor();assert.match(await page.locator('.fs-metrics').first().innerText(),/0.00/);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:out+`/statements-${lang}-${width}.png`,fullPage:true})});
 await check('Personal position opens from reporting and only reads the signed-in owner cash register',async()=>{
  await page.setViewportSize({width:1672,height:941});
  sql(`insert into public.asset_accounts(user_id,ownership_scope,asset_type,name,currency) values
    ('${a.id}','PERSONAL','CASH','Owner QA personal cash','SAR'),('${b.id}','PERSONAL','CASH','Other QA personal cash','SAR');`);
  await page.goto(app+'/en/dashboard?scope=PERSONAL');
  const menu=page.getByRole('button',{name:/Financial reports & statements/i});
  if(await menu.getAttribute('aria-expanded')!=='true')await menu.click();
  const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/financial-register'&&new URL(r.url()).searchParams.get('scope')==='PERSONAL');
  await page.getByRole('link',{name:'Personal financial position summary',exact:true}).click();
  const read=await response;assert.equal(read.status(),200);const data=await read.json();
  assert.equal(new URL(page.url()).searchParams.get('scope'),'PERSONAL');
  assert.ok(data.accounts.some(x=>x.name==='Owner QA personal cash'));
  assert.ok(data.accounts.every(x=>x.organizationId===null&&x.name!=='Other QA personal cash'));
 });
 await check('Financial reports open in Business from either dashboard scope',async()=>{
  await page.setViewportSize({width:1672,height:941});
  for(const scope of ['PERSONAL','ORGANIZATION']){
   await page.goto(app+'/en/dashboard?scope='+scope+'&organization='+org);
   const menu=page.getByRole('button',{name:/Financial reports & statements/i});
   if(await menu.getAttribute('aria-expanded')!=='true')await menu.click();
   await page.getByRole('link',{name:'Financial position',exact:true}).click();
   await page.locator('[data-statement-ready="position"]').waitFor();
   assert.equal(await page.getByRole('button',{name:'Business',exact:true}).getAttribute('aria-pressed'),'true');
   const url=new URL(page.url());assert.equal(url.searchParams.get('organization'),org);assert.equal(url.searchParams.get('screen'),'position');
  }
  await page.goto(app+'/en/financial-reports?screen=position&organization='+other);
  await page.getByRole('heading',{name:'No authorized statement sources'}).waitFor();
  assert.equal(await page.locator('[data-statement-ready]').count(),0);
 });
 await check('Expired subscription keeps authorized reads and blocks opening writes',async()=>{sql(`update public.platform_subscriptions set trial_started_at=now()-interval '31 days',trial_ends_at=now()-interval '1 day' where organization_id='${org}'`);const r=await a.client.rpc('financial_opening_workspace',scope);assert.ifError(r.error);assert.equal(r.data.canSave,false);assert.equal(r.data.canApprove,false);assert.ok((await a.client.rpc('save_financial_opening',{...scope,p_expected_version:0,p_source_revision:r.data.source.revision,p_entries:{},p_reason:''})).error);sql(`update public.platform_subscriptions set trial_started_at=now(),trial_ends_at=now()+interval '30 days' where organization_id='${org}'`)});
 await check('Paid supplier invoice credit from register to financial position',async()=>{
  const contact='a0900000-0000-4000-8000-000000000001';
  sql(`insert into public.vat_profiles(organization_id,registration_status,tax_registration_number) values('${org}','REGISTERED','310000000000003') on conflict(organization_id) do update set registration_status='REGISTERED',tax_registration_number=excluded.tax_registration_number;
  insert into public.organization_entities(organization_id,name) select '${org}','Refund QA' where not exists(select 1 from public.organization_entities where organization_id='${org}' and active);
  insert into public.vat_contacts(id,organization_id,contact_type,name,created_by) values('${contact}','${org}','SUPPLIER','QA refund supplier','${a.id}');
  insert into public.financial_classifications(organization_id,code,name,classification_type,created_by) select '${org}',type,type,type,'${a.id}' from unnest(array['OPEX','TAX','PAYABLE']) type on conflict(organization_id,code) do nothing;`);
  async function expectResponse(response,status){const body=await response.json();assert.equal(response.status(),status,JSON.stringify(body));return body}
  const req=page.request,scope={organization_id:org};
  const invoice=await expectResponse(await req.post(app+'/api/vat',{data:{...scope,action:'add_document',document_number:'QA-PUR-01',document_type:'PURCHASE',document_kind:'INVOICE',transaction_date:'2026-02-01',due_date:'2026-02-01',counterparty_name:'QA refund supplier',counterparty_contact_id:contact,supply_type:'STANDARD',net_amount:100,recoverable_percent:50,currency:'SAR',exchange_rate:1}}),201);
  await expectResponse(await req.post(app+'/api/vat/recognition',{data:{...scope,document_id:invoice.id}}),200);
  await expectResponse(await req.patch(app+'/api/liquidity/'+invoice.financial_core.cash_flow_id,{data:{status:'ACTUAL',amount:115,account_id:cash,settlement_date:'2026-02-02'}}),200);
  async function actions(number){
   await page.goto(app+'/en/vat?section=unified&organization_id='+org);
   const row=page.locator('.vat-unified-table tbody tr').filter({hasText:number});
   await row.locator('.invoice-actions-trigger').click();
   await row.getByRole('button',{name:'Actions',exact:true}).click();
  }
  await actions('QA-PUR-01');
  await page.getByRole('button',{name:'Linked credit note',exact:true}).click();
  await page.getByLabel('Document number',{exact:true}).fill('QA-CREDIT-46');
  await page.getByLabel('Document date',{exact:true}).fill('2026-03-01');
  await page.getByLabel('Due date',{exact:true}).fill('2026-03-01');
  await page.getByLabel('Net before VAT',{exact:true}).fill('40');
  await page.getByLabel('Notes / note reason',{exact:true}).fill('Partial return after full payment');
  const saved=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/vat'&&r.request().method()==='POST');
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await expectResponse(await saved,201);
  await actions('QA-CREDIT-46');
  const posted=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/vat/notes'&&r.request().method()==='POST');
  await page.getByRole('button',{name:'Post accounting',exact:true}).click();
  await expectResponse(await posted,200);
  const input={p_org:org,p_fiscal_start:'2026-01-01'};
  const policy=await a.client.rpc('financial_reporting_policy_workspace',input);assert.ifError(policy.error);
  const rules=new Map();
  for(const e of policy.data.events)for(const l of e.lines){
   const supplierRefund=l.classificationId==='VAT_NOTE_REFUND_RECEIVABLE',payment=l.cashDirection==='OUTFLOW';
   const rule={eventType:e.eventType,sourceModule:e.sourceModule,classificationId:l.classificationId,cashDirection:l.cashDirection,debitAccountId:payment?'2100':supplierRefund?'1800':l.classificationId.endsWith(':INPUT_VAT_RECOVERABLE')?'1400':'6100',creditAccountId:payment?'1000':'2100',...(payment?{cashActivity:'OPERATING'}:{})};
   rules.set(JSON.stringify(rule),rule);
  }
  const draft=await a.client.rpc('save_financial_reporting_policy',{...input,p_expected_version:0,p_rules:[...rules.values()],p_reason:'Map supplier refund separately from original payable'});assert.ifError(draft.error);
  const ap=await a.client.rpc('approve_financial_reporting_policy',{p_id:draft.data.id,p_expected_version:draft.data.version});assert.ifError(ap.error);
  const query='/api/financial-reporting/live-statements?action=statements&organization='+org+'&from=2026-01-01&to=';
  const before=await expectResponse(await req.get(app+query+'2026-02-28'),200);
  const after=await expectResponse(await req.get(app+query+'2026-03-31'),200);
  assert.equal(before.statements.cash.closing,'385.0000');assert.equal(after.statements.cash.closing,before.statements.cash.closing);
  assert.equal(after.accounts.find(x=>x.id==='1800').balance,'46.0000');assert.equal(after.accounts.find(x=>x.id==='2100').balance,'0.0000');
  assert.equal(after.statements.income.operatingExpenses,'64.5000');assert.equal(after.statements.position.assets,'435.5000');
  await page.goto(app+'/en/financial-reports?screen=position');
  const position=page.locator('[data-statement-ready="position"]');await position.waitFor();
  assert.match(await position.innerText(),/435\.50/);
  await page.screenshot({path:out+'/supplier-credit-financial-position.png',fullPage:true});
 });
 await check('Revocation clears both refreshed and exporting workspaces',async()=>{
  const exportPage=await context.newPage();
  const downloads=[];
  exportPage.on('download', file=>downloads.push(file.suggestedFilename()));
  try{
   for(const tab of [page,exportPage]){
    await tab.goto(app+'/en/opening-balances');
    await tab.locator('[data-opening-ready="'+org+'"]').waitFor();
   }
   sql(`update public.organization_members set status='INACTIVE' where organization_id='${org}' and user_id='${a.id}'`);
   assert.ok((await a.client.rpc('financial_opening_workspace',scope)).error);
   for(const [tab,name] of [[page,'Refresh sources'],[exportPage,'CSV']]){
    const denied=tab.waitForResponse(r=>{
     const u=new URL(r.url());
     return u.pathname==='/api/financial-reporting/openings'&&u.searchParams.get('organization')===org;
    });
    await tab.getByRole('button',{name,exact:true}).click();
    assert.equal((await denied).status(),403);
    await tab.locator('.ob-invalid[role="alert"]').waitFor();
    assert.equal(await tab.locator('[data-opening-ready]').count(),0);
    assert.equal(await tab.getByText('Fiscal calendar and annual close',{exact:true}).count(),0);
    assert.equal(await tab.getByRole('button',{name:'CSV',exact:true}).count(),0);
   }
   assert.deepEqual(downloads,[]);
  }finally{await exportPage.close()}
 });
 await check('Concurrent annual close retries are atomic and real amount-limited users cannot close',async()=>{
  const fiscalOrg=randomUUID(),fiscalBank=randomUUID(),request=randomUUID();
  sql(`select set_config('request.jwt.claim.sub','${a.id}',false);
   insert into public.organizations(id,owner_user_id,name) values('${fiscalOrg}','${a.id}','ZZ independent concurrent fiscal fixture');
   insert into public.organization_members(organization_id,user_id,role,status) values('${fiscalOrg}','${a.id}','OWNER','ACTIVE'),('${fiscalOrg}','${b.id}','VIEWER','ACTIVE') on conflict(organization_id,user_id) do update set role=excluded.role,status='ACTIVE';
   insert into public.organization_member_permission_overrides(organization_id,user_id,permission,effect,amount_limit,currency,created_by)
    values('${fiscalOrg}','${b.id}','financial_core.view','ALLOW',null,null,'${a.id}'),('${fiscalOrg}','${b.id}','financial_core.approve','ALLOW',50,'SAR','${a.id}'),('${fiscalOrg}','${b.id}','financial_core.post','ALLOW',50,'SAR','${a.id}');
   insert into public.liquidity_accounts(id,organization_id,name,account_type,currency,current_balance,current_balance_base,created_by,metadata)
    values('${fiscalBank}','${fiscalOrg}','Concurrent close bank','BANK','SAR',100,100,'${a.id}','{"opening_date":"2023-12-31","opening_balance":100,"opening_fx_rate":1}');`);
  assert.ifError((await a.client.rpc('save_financial_fiscal_calendar',{p_org:fiscalOrg,p_month:1,p_day:1,p_retained:'3300',p_expected_version:0,p_reason:'Independent concurrent calendar'})).error);
  const opening=await a.client.rpc('financial_opening_workspace',{p_org:fiscalOrg,p_fiscal_start:'2024-01-01'});assert.ifError(opening.error);
  const entries=Object.fromEntries(opening.data.source.rows.filter(row=>row.vouchers.length===0).map(row=>[row.id,{amount:'0',side:row.normal}]));entries['equity:3100']={amount:'100',side:'CREDIT'};
  const draft=await a.client.rpc('save_financial_opening',{p_org:fiscalOrg,p_fiscal_start:'2024-01-01',p_expected_version:0,p_source_revision:opening.data.source.revision,p_entries:entries,p_reason:'Balanced source trial for concurrent close'});assert.ifError(draft.error);
  assert.ifError((await a.client.rpc('approve_financial_opening',{p_id:draft.data.id,p_expected_version:1})).error);
  const policy=await a.client.rpc('save_financial_reporting_policy',{p_org:fiscalOrg,p_fiscal_start:'2024-01-01',p_expected_version:0,p_rules:[],p_reason:'No current-year operations'});assert.ifError(policy.error);
  assert.ifError((await a.client.rpc('approve_financial_reporting_policy',{p_id:policy.data.id,p_expected_version:1})).error);
  const limited=await b.client.rpc('close_financial_year',{p_org:fiscalOrg,p_start:'2024-01-01',p_request:randomUUID(),p_reason:'Amount limit must be enforced'});assert.match(limited.error?.message??'',/FISCAL_CLOSE_DENIED/);
  const outcomes=await Promise.all([1,2].map(()=>a.client.rpc('close_financial_year',{p_org:fiscalOrg,p_start:'2024-01-01',p_request:request,p_reason:'Concurrent retry of one closing command'})));
  for(const outcome of outcomes)assert.ifError(outcome.error);
  assert.equal(outcomes[0].data.id,outcomes[1].data.id);
  const closes=await a.client.from('financial_year_closures').select('id').eq('organization_id',fiscalOrg);assert.ifError(closes.error);assert.equal(closes.data.length,1);
  const audit=await a.client.from('financial_fiscal_audit').select('id').eq('organization_id',fiscalOrg).eq('action','YEAR_CLOSE');assert.ifError(audit.error);assert.equal(audit.data.length,1);
 });
 assert.deepEqual(errors,[]);report.browserExceptions=errors;await context.close();
}finally{await browser?.close();server?.kill();await writeFile(out+'/results.json',JSON.stringify(report,null,2)+'\n')}
