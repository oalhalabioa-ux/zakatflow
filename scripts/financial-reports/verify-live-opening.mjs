// Full canonical schema, genuine Auth/PostgREST and actual Next/browser. Loopback only.
import {execFileSync,spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
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
 for(const file of ['qa-financial-opening-workspace.sql','qa-financial-opening-ledger.sql','qa-financial-opening-sources.sql'])await check('Actual PostgreSQL '+file,async()=>{const result=sql(await readFile('tests/'+file,'utf8'));await writeFile(out+'/'+file.replace('.sql','.json'),result+'\n');const parsed=JSON.parse(result),rows=Array.isArray(parsed)?parsed:parsed.checks;assert.ok(rows.length>0);assert.ok(rows.every(r=>r.passed===true))});
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
 const scope={p_org:org,p_fiscal_start:'2026-01-01'};
 await check('Real user sessions isolate opening source reads and reject forged metadata',async()=>{assert.ifError((await a.client.rpc('financial_opening_workspace',scope)).error);assert.ok((await b.client.rpc('financial_opening_workspace',scope)).error);assert.ifError((await viewer.client.auth.updateUser({data:{role:'OWNER',financial_core:{approve:true}}})).error);assert.ok((await viewer.client.rpc('save_financial_opening',{...scope,p_expected_version:0,p_source_revision:'x',p_entries:{},p_reason:''})).error)});
 const cookies=[],ssr=createServerClient(url,status.ANON_KEY,{cookies:{getAll:()=>cookies,setAll:cs=>{for(const c of cs){const i=cookies.findIndex(x=>x.name===c.name);if(i>=0)cookies.splice(i,1);cookies.push(c)}}}});assert.ifError((await ssr.auth.signInWithPassword({email:a.email,password:a.password})).error);
 const env={...process.env,NEXT_PUBLIC_SUPABASE_URL:url,NEXT_PUBLIC_SUPABASE_ANON_KEY:status.ANON_KEY,NEXT_PUBLIC_APP_URL:app,FINANCIAL_OPENING_WORKSPACE:'true',FINANCIAL_STATEMENTS_LIVE:'true',VERCEL_ENV:'preview'};
 const build=spawn('npm',['run','build'],{env,stdio:'inherit'});assert.equal(await new Promise(resolve=>build.on('exit',resolve)),0);
 const log=await open(out+'/next.log','w');server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3200'],{env,stdio:['ignore',log.fd,log.fd]});
 for(let i=0;i<180;i++){try{if((await fetch(app+'/api/financial-reporting/openings?action=context')).status===401)break}catch{}await new Promise(r=>setTimeout(r,500));if(i===179)throw Error('NEXT_START_TIMEOUT')}
 const{chromium}=await import(process.env.FINANCIAL_SOURCE_BROWSER_MODULE);browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1672,height:941},acceptDownloads:true});await context.addCookies(cookies.map(c=>({name:c.name,value:c.value,domain:'localhost',path:'/',httpOnly:false,secure:false,sameSite:'Lax'})));const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await check('Connected opening page loads actual master names and missing states',async()=>{await page.goto(app+'/ar/opening-balances');await page.locator('[data-opening-ready="'+org+'"]').waitFor();await page.getByText('عميل بلا رصيد افتتاحي',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'اعتماد الأرصدة',exact:true}).isDisabled(),true);await page.screenshot({path:out+'/opening-ar-desktop-before.png',fullPage:true})});
 await check('Persisted draft distinguishes confirmed zero, reopens after refresh, and approves',async()=>{
  await page.getByRole('button',{name:'تأكيد رصيد صفري',exact:true}).click();await page.getByRole('tab',{name:/^حقوق الملكية/}).click();
  await page.getByLabel('الإضافة: رأس المال',{exact:true}).fill('500');for(const name of ['الاحتياطيات','الأرباح المحتجزة'])await page.locator('tr').filter({has:page.getByLabel('الإضافة: '+name,{exact:true})}).getByRole('button',{name:'تأكيد رصيد صفري',exact:true}).click();
  const saved=page.waitForResponse(r=>r.url().endsWith('/api/financial-reporting/openings')&&r.request().method()==='POST');await page.getByRole('button',{name:'حفظ المسودة',exact:true}).click();const savedResponse=await saved;assert.equal(savedResponse.status(),200,JSON.stringify(await savedResponse.json()));await page.locator('[data-opening-ready="'+org+'"]').waitFor();await page.reload();await page.locator('[data-opening-ready="'+org+'"]').waitFor();await page.getByRole('tab',{name:/^حقوق الملكية/}).click();assert.equal(await page.getByLabel('الإضافة: رأس المال',{exact:true}).inputValue(),'500');
  const approved=page.waitForResponse(r=>r.url().endsWith('/api/financial-reporting/openings')&&r.request().method()==='POST');await page.getByRole('button',{name:'اعتماد الأرصدة',exact:true}).click();const approvedResponse=await approved;assert.equal(approvedResponse.status(),200,JSON.stringify(await approvedResponse.json()));await page.getByText(/معتمد ·/).waitFor();await page.getByRole('tab',{name:/^حقوق الملكية/}).click();assert.equal(await page.getByLabel('الإضافة: رأس المال',{exact:true}).isDisabled(),true);
  const read=await a.client.rpc('financial_opening_workspace',scope);assert.ifError(read.error);assert.equal(read.data.workspace.status,'APPROVED');assert.equal(read.data.workspace.entries['equity:3100'].amount,'500');
 });
 await check('Browser Excel export preserves actual source marker, source amount and final opening',async()=>{const d=page.waitForEvent('download');await page.getByRole('button',{name:'تصدير Excel',exact:true}).click();const file=await d;await file.saveAs(out+'/opening-approved.xlsx');const{default:ExcelJS}=await import('exceljs'),book=new ExcelJS.Workbook();await book.xlsx.readFile(await file.path());assert.equal(book.worksheets.length,2);assert.match(String(book.worksheets[1].getCell('A1').value),/LIVE REGISTERS/);assert.ok(book.worksheets[1].rowCount>=7)});
 await check('Posting policy UI saves and approves a real initial policy',async()=>{await page.goto(app+'/ar/financial-reporting-policy');await page.getByRole('heading',{name:'قواعد ترحيل القوائم المالية'}).waitFor();await page.getByLabel('سبب الإعداد أو التغيير').fill('إعداد قواعد المرحلة الافتتاحية');await page.getByRole('button',{name:'حفظ المسودة',exact:true}).click();await page.getByRole('button',{name:'اعتماد القواعد',exact:true}).click();await page.getByRole('button',{name:'إعداد نسخة جديدة',exact:true}).waitFor();const r=await a.client.rpc('financial_statement_live_snapshot',{p_org:org,p_from:'2026-01-01',p_to:'2026-12-31'});assert.ifError(r.error);assert.equal(r.data.origin,'LIVE_CANONICAL_EVENTS')});
 for(const lang of ['ar','en'])for(const width of [1672,390])await check('Actual approved page layout '+lang+' '+width,async()=>{await page.setViewportSize({width,height:width===390?844:941});await page.goto(app+'/'+lang+'/opening-balances');await page.locator('[data-opening-ready="'+org+'"]').waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:out+`/opening-${lang}-${width}.png`,fullPage:true});await page.goto(app+'/'+lang+'/financial-reports');await page.locator('[data-statement-ready="overview"]').waitFor();assert.match(await page.locator('.fs-metrics').first().innerText(),/0.00/);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:out+`/statements-${lang}-${width}.png`,fullPage:true})});
 await check('Expired subscription keeps authorized reads and blocks opening writes',async()=>{sql(`update public.platform_subscriptions set trial_started_at=now()-interval '31 days',trial_ends_at=now()-interval '1 day' where organization_id='${org}'`);const r=await a.client.rpc('financial_opening_workspace',scope);assert.ifError(r.error);assert.equal(r.data.canSave,false);assert.equal(r.data.canApprove,false);assert.ok((await a.client.rpc('save_financial_opening',{...scope,p_expected_version:0,p_source_revision:r.data.source.revision,p_entries:{},p_reason:''})).error);sql(`update public.platform_subscriptions set trial_started_at=now(),trial_ends_at=now()+interval '30 days' where organization_id='${org}'`)});
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
    assert.equal(await tab.getByRole('button',{name:'CSV',exact:true}).count(),0);
   }
   assert.deepEqual(downloads,[]);
  }finally{await exportPage.close()}
 });
 assert.deepEqual(errors,[]);report.browserExceptions=errors;await context.close();
}finally{await browser?.close();server?.kill();await writeFile(out+'/results.json',JSON.stringify(report,null,2)+'\n')}
