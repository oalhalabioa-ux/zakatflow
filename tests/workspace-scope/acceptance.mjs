// Genuine Auth, canonical database, actual Next pages and Chromium. Loopback only.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {execFileSync,spawn} from 'node:child_process';
import {mkdir,open,writeFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {createClient} from '@supabase/supabase-js';
import {createServerClient} from '@supabase/ssr';
import {budgetScopeAcceptance} from './budget-checks.mjs';
import {routeOpeningAcceptance} from './route-opening-checks.mjs';

const root=process.env.SCOPE_QA_WORKDIR;
assert.ok(root&&process.env.RUNNER_TEMP&&root.startsWith(process.env.RUNNER_TEMP+'/'),'DISPOSABLE_RUNNER_REQUIRED');
const status=JSON.parse(execFileSync('npx',['--yes','supabase@2.122.0','status','--workdir',root,'--output','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
assert.equal(status.API_URL,'http://127.0.0.1:54321','REMOTE_DATABASE_FORBIDDEN');
const app='http://localhost:3211',out='tests/workspace-scope/artifacts';
const admin=createClient(status.API_URL,status.SERVICE_ROLE_KEY,{auth:{autoRefreshToken:false,persistSession:false}});
const {chromium}=await import(process.env.SCOPE_BROWSER_MODULE);
const checks=[],pageErrors=[];
const report={engine:'Canonical Supabase migrations + genuine Auth/PostgREST + Next + Chromium',sha:process.env.GITHUB_SHA??null,remoteConnections:false,checks};
const sql=input=>execFileSync('docker',['exec','-i','supabase_db_workspace-scope-qa','psql','-X','-q','-t','-A','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres'],{input,encoding:'utf8',timeout:60000,maxBuffer:8*1024*1024,stdio:['pipe','pipe','pipe']}).trim();
const value=result=>{if(result.error)throw Error(result.error.message);return result.data;};
async function check(name,run){
 console.log('CHECK '+name);
 try{await run();checks.push({name,status:'passed'});console.log('PASS '+name);}
 catch(error){
  checks.push({name,status:'failed',error:error instanceof Error?error.message:String(error)});
  await captureFailurePage(name).catch(()=>{report.failurePage??={unavailable:true};});
  console.log('FAIL '+name+': '+(error instanceof Error?error.message:String(error)));
  throw error;
 }
}
async function actor(){
 const email=`scope-${randomUUID()}@workspace.invalid`,password=randomUUID()+'Aa7!';
 const {user}=value(await admin.auth.admin.createUser({email,password,email_confirm:true}));
 const cookies=new Map();
 const client=createServerClient(status.API_URL,status.ANON_KEY,{cookies:{getAll:()=>[...cookies.values()],setAll:entries=>entries.forEach(cookie=>cookies.set(cookie.name,cookie))}});
 value(await client.auth.signInWithPassword({email,password}));
 return {id:user.id,client,cookies:[...cookies.values()]};
}
async function contextFor(browser,actor,viewport={width:1440,height:1000}){
 const context=await browser.newContext({viewport,acceptDownloads:true});
 await context.addCookies(actor.cookies.map(({name,value})=>({name,value,url:app})));
 await context.addInitScript(()=>localStorage.setItem('zf-theme','yaqeen-business'));
 return context;
}
async function captureFailurePage(checkName){
 if(!checkName&&report.failurePage)return;
 // Diagnostics contain only the local synthetic UI, never request headers,
 // cookies, storage, environment variables or HTML containing auth state.
 const page=browser?.contexts().flatMap(context=>context.pages())
  .filter(page=>!page.isClosed()&&page.url().startsWith(app+'/')).at(-1);
 if(!page)return;
 const redact=text=>text
  .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[synthetic email]')
  .replace(/\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,'[redacted token]')
  .replace(/\b(?:sb_secret_|sb_publishable_)[A-Za-z0-9_-]+\b/g,'[redacted key]');
 const url=new URL(page.url()),query=new URLSearchParams();
 for(const key of ['scope','organization','organization_id','level']){
  const value=url.searchParams.get(key);if(value!==null)query.set(key,value);
 }
 const location=url.pathname+(query.size?'?'+query:'');
 const evidence={check:checkName??'Acceptance setup',location};
 report.failurePages??=[];
 const prefix='failure-'+(report.failurePages.length+1);
 report.failurePages.push(evidence);report.failurePage??=evidence;
 try{
  const visible=await page.locator('body').innerText({timeout:5000});
  await writeFile(out+'/'+prefix+'.txt',redact(location+'\n\n'+visible).slice(0,30000)+'\n');
  evidence.visibleText=prefix+'.txt';
 }catch{evidence.visibleTextUnavailable=true;}
 try{
  await page.screenshot({path:out+'/'+prefix+'.png',fullPage:false,timeout:5000,
   mask:[page.locator('input, textarea, [data-sensitive], a[href^="mailto:"], nextjs-portal')]});
  evidence.screenshot=prefix+'.png';
 }catch{evidence.screenshotUnavailable=true;}
}
const terms=(name,scope,organization_id,bank)=>({name,instrument:'DEPOSIT',ownership_scope:scope,organization_id,party_name:'Scope QA bank',currency:'SAR',principal:1000,face_value:1000,fees:0,annual_rate:5,start_date:'2026-01-01',maturity_date:'2027-01-01',interest_basis:'ACT_365',zakat_basis:'HIJRI_354',zakat_rate:0,zakat_base:1000,zakat_treatment:'INVESTOR',inflation_rate:0,fx_rate:1,funding_account_id:bank});
let server,browser;
await mkdir(out,{recursive:true});
try{
 const owner=await actor(),other=await actor(),fresh=await actor(),colleague=await actor();
 const orgA=randomUUID(),orgB=randomUUID(),foreignOrg=randomUUID(),bankA=randomUUID(),bankB=randomUUID(),personalBank=randomUUID();
 const personalAsset=randomUUID(),assetA=randomUUID(),assetB=randomUUID(),foreignAsset=randomUUID();
 const personalTx=randomUUID(),txA=randomUUID(),txB=randomUUID();
 const colleagueAsset=randomUUID(),colleagueTx=randomUUID(),personalLot=randomUUID(),lotA=randomUUID(),lotB=randomUUID(),colleagueLot=randomUUID();
 sql(`select set_config('request.jwt.claim.sub','${owner.id}',false);
 insert into public.organizations(id,owner_user_id,name,base_currency) values('${orgA}','${owner.id}','Scope Company A','SAR');
 insert into public.organizations(id,owner_user_id,name,base_currency,parent_organization_id,organization_kind) values('${orgB}','${owner.id}','Scope Company B','SAR','${orgA}','SUBSIDIARY');
 select set_config('request.jwt.claim.sub','${other.id}',false);
 insert into public.organizations(id,owner_user_id,name,base_currency) values('${foreignOrg}','${other.id}','Scope Foreign Company','SAR');
 select set_config('request.jwt.claim.sub','${owner.id}',false);
 insert into public.organization_members(organization_id,user_id,role,status) values
 ('${orgA}','${owner.id}','OWNER','ACTIVE'),('${orgB}','${owner.id}','OWNER','ACTIVE'),('${foreignOrg}','${other.id}','OWNER','ACTIVE'),('${orgA}','${colleague.id}','ACCOUNTANT','ACTIVE')
 on conflict(organization_id,user_id) do update set role=excluded.role,status='ACTIVE';
 insert into public.liquidity_accounts(id,organization_id,name,account_type,currency,current_balance,current_balance_base,created_by,metadata) values
 ('${bankA}','${orgA}','Scope Bank A','BANK','SAR',5000,5000,'${owner.id}','{"opening_date":"2025-12-31","opening_balance":5000,"opening_fx_rate":1}'),
 ('${bankB}','${orgB}','Scope Bank B','BANK','SAR',5000,5000,'${owner.id}','{"opening_date":"2025-12-31","opening_balance":5000,"opening_fx_rate":1}');
 insert into public.asset_accounts(id,user_id,asset_type,name,currency,unit,is_zakatable,ownership_scope,organization_id) values
 ('${personalAsset}','${owner.id}','GOLD','Scope Personal Gold','SAR','g',false,'PERSONAL',null),
 ('${personalBank}','${owner.id}','BANK','Scope Personal Bank','SAR','SAR',false,'PERSONAL',null),
 ('${assetA}','${owner.id}','GOLD','Scope Company A Gold','SAR','g',false,'ORGANIZATION','${orgA}'),
 ('${assetB}','${owner.id}','GOLD','Scope Company B Gold','SAR','g',false,'ORGANIZATION','${orgB}'),
 ('${colleagueAsset}','${colleague.id}','GOLD','Scope Company A Colleague Gold','SAR','g',false,'ORGANIZATION','${orgA}'),
 ('${foreignAsset}','${other.id}','GOLD','Scope Foreign Gold','SAR','g',false,'ORGANIZATION','${foreignOrg}');
 insert into public.transactions(id,user_id,asset_account_id,organization_id,transaction_type,transaction_date,quantity,currency,gross_value,base_currency,base_value,created_by,reference) values
 ('${personalTx}','${owner.id}','${personalAsset}',null,'OPENING_BALANCE','2026-01-01',10,'SAR',100,'SAR',100,'${owner.id}','SCOPE-PERSONAL'),
 ('${txA}','${owner.id}','${assetA}','${orgA}','OPENING_BALANCE','2026-01-01',20,'SAR',200,'SAR',200,'${owner.id}','SCOPE-COMPANY-A'),
 ('${txB}','${owner.id}','${assetB}','${orgB}','OPENING_BALANCE','2026-01-01',30,'SAR',300,'SAR',300,'${owner.id}','SCOPE-COMPANY-B'),
 ('${colleagueTx}','${colleague.id}','${colleagueAsset}','${orgA}','OPENING_BALANCE','2026-01-01',40,'SAR',400,'SAR',400,'${colleague.id}','SCOPE-COMPANY-COLLEAGUE');
 insert into public.lots(id,user_id,asset_account_id,source_transaction_id,acquisition_date,original_quantity,remaining_quantity,original_value_base,remaining_value_base) values
 ('${personalLot}','${owner.id}','${personalAsset}','${personalTx}','2026-01-01',10,10,100,100),
 ('${lotA}','${owner.id}','${assetA}','${txA}','2026-01-01',20,20,200,200),
 ('${lotB}','${owner.id}','${assetB}','${txB}','2026-01-01',30,30,300,300),
 ('${colleagueLot}','${colleague.id}','${colleagueAsset}','${colleagueTx}','2026-01-01',40,40,400,400);`);
 assert.equal(value(await fresh.client.rpc('organization_onboarding_required')),true,'Fresh personal actor must have no institution');
 const log=await open(process.env.RUNNER_TEMP+'/workspace-scope-next.log','w');
 const appEnv={...process.env,NEXT_PUBLIC_SUPABASE_URL:status.API_URL,NEXT_PUBLIC_SUPABASE_ANON_KEY:status.ANON_KEY,NEXT_PUBLIC_APP_URL:app,NEXT_PUBLIC_APP_ENV:'test',NEXT_TELEMETRY_DISABLED:'1',FINANCIAL_OPENING_WORKSPACE:'true',FINANCIAL_STATEMENTS_LIVE:'true',NEXT_PUBLIC_FEASIBILITY_STUDIES:'true',SUPABASE_SERVICE_ROLE_KEY:'',RESEND_API_KEY:''};
 console.log('BUILD Production application against disposable loopback configuration');
 execFileSync(process.execPath,['node_modules/next/dist/bin/next','build'],{env:appEnv,stdio:['ignore',log.fd,log.fd],timeout:300000});
 server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p','3211'],{
  env:appEnv,
  stdio:['ignore',log.fd,log.fd],
 });
 let ready=false;
 for(let i=0;i<120;i++){try{if((await fetch(app+'/ar/login',{signal:AbortSignal.timeout(2000)})).ok){ready=true;break;}}catch{}await delay(500);}
 assert.ok(ready,'Local Next server must start');
 browser=await chromium.launch({headless:true});
 const freshContext=await contextFor(browser,fresh),freshPage=await freshContext.newPage();
 freshPage.setDefaultTimeout(30000);
 await check('Fresh personal account opens dashboard without creating an organization',async()=>{
  const response=await freshPage.goto(app+'/ar/dashboard?scope=PERSONAL',{waitUntil:'domcontentloaded',timeout:90000});
  assert.equal(response.status(),200);assert.ok(new URL(freshPage.url()).pathname.endsWith('/dashboard'));
  await freshPage.locator('.platform-personal').waitFor();
  await freshPage.locator('.corp-workspace-scope button[aria-pressed="true"]').filter({hasText:'شخصي'}).waitFor();
  await freshPage.goto(app+'/en/dashboard',{waitUntil:'domcontentloaded',timeout:90000});
  await freshPage.locator('.platform-personal').waitFor();
  assert.equal(value(await fresh.client.rpc('organization_onboarding_required')),true,'Personal navigation must not create an institution');
 });
 await check('Fresh business access still requires institutional onboarding',async()=>{
  await freshPage.goto(app+'/en/dashboard?scope=ORGANIZATION',{waitUntil:'domcontentloaded',timeout:90000});
  await freshPage.waitForURL(url=>url.pathname==='/en/onboarding');
 });
 await freshContext.close();

 const ownerContext=await contextFor(browser,owner),page=await ownerContext.newPage();
 page.setDefaultTimeout(30000);page.setDefaultNavigationTimeout(90000);
 page.on('pageerror',error=>pageErrors.push(error.message));
 const request=(method,path,data)=>ownerContext.request.fetch(app+path,{method,headers:{Origin:app},...(data===undefined?{}:{data})});
 const outsiderContext=await contextFor(browser,other);
 await check('Company lot access follows authorized assets across team members and refuses unrelated users',async()=>{
  for(const [query,expected] of [['scope=PERSONAL',[personalLot]],[`scope=ORGANIZATION&organization_id=${orgA}`,[lotA,colleagueLot]],[`scope=ORGANIZATION&organization_id=${orgB}`,[lotB]],[`scope=ORGANIZATION&organization_id=${orgA}&group=1`,[lotA,lotB,colleagueLot]]]){
   const response=await request('GET','/api/lots?'+query);const body=await response.json();assert.equal(response.status(),200,JSON.stringify(body));assert.deepEqual(body.map(lot=>lot.id).sort(),expected.sort());
  }
  const detail=await request('GET','/api/lots/'+colleagueLot);const row=await detail.json();assert.equal(detail.status(),200,JSON.stringify(row));assert.equal(row.id,colleagueLot);assert.equal(row.organization_id,orgA);
  assert.equal((await outsiderContext.request.get(app+`/api/lots?scope=ORGANIZATION&organization_id=${orgA}`)).status(),403);
  assert.ok([403,404].includes((await outsiderContext.request.get(app+'/api/lots/'+colleagueLot)).status()));
  assert.equal((await request('GET',`/api/lots?scope=PERSONAL&organization_id=${orgA}`)).status(),400);
 });
 await check('Scoped print fixtures use canonical manual assessment drafts',async()=>{
  for(const [organization_id,name,cash] of [[orgA,'Scope assessment A',12345],[orgB,'Scope assessment B',54321]]){
   const input={model:'SIMPLE',organization_id,title:name,assessment_date:'2026-01-02',currency:'SAR',values:{cash},debt_policy:'NONE',method_reference:'',nisab_value:1,nisab_reference:'Synthetic QA',hawl_completed:true,period_basis:'HIJRI',period_start:null,period_end:null,hijri_days:354,notes:'Disposable scope acceptance fixture',independent_source_confirmed:true};
   const response=await request('POST','/api/assessments/manual',{request_id:randomUUID(),input});
   const body=await response.json();assert.equal(response.status(),201,JSON.stringify(body));assert.equal(body.organization_id,organization_id);assert.equal(Number(body.result.base),cash);
  }
 });
 let personalContract,contractA,contractB;
 await check('Investment drafts save separately under personal and two owned institutions',async()=>{
  for(const [scope,org,bank,name,set] of [
   ['PERSONAL',null,personalBank,'Scope Personal Deposit',id=>personalContract=id],
   ['ORGANIZATION',orgA,bankA,'Scope Company A Deposit',id=>contractA=id],
   ['ORGANIZATION',orgB,bankB,'Scope Company B Deposit',id=>contractB=id],
  ]){
   const response=await request('POST','/api/investments',{action:'SAVE',request_id:randomUUID(),workspace:{scope,organization_id:org,group:false},payload:terms(name,scope,org,bank)});
   const body=await response.json();assert.equal(response.status(),200,JSON.stringify(body));assert.ok(body.id);set(body.id);
  }
 });
 await check('Investment reads exclude other owned scopes and enforce unrelated-user access',async()=>{
  for(const [query,expected] of [['scope=PERSONAL',[personalContract]],[`scope=ORGANIZATION&organization_id=${orgA}`,[contractA]],[`scope=ORGANIZATION&organization_id=${orgB}`,[contractB]],[`scope=ORGANIZATION&organization_id=${orgA}&group=1`,[contractA,contractB]]]){
   const response=await request('GET','/api/investments?'+query);assert.equal(response.status(),200);
   const data=await response.json();assert.deepEqual(data.contracts.map(c=>c.id).sort(),expected.sort());
   if(query==='scope=PERSONAL')assert.deepEqual(data.organizationAccounts,[]);else assert.deepEqual(data.personalAccounts,[]);
  }
  assert.equal((await outsiderContext.request.get(app+`/api/investments?scope=ORGANIZATION&organization_id=${orgA}`)).status(),403);
  assert.equal((await request('GET',`/api/investments?scope=PERSONAL&organization_id=${orgA}`)).status(),400);
 });
 await check('Investment writes reject stale-scope IDs and mismatched terms',async()=>{
  const stale=await request('POST','/api/investments',{action:'CANCEL',id:personalContract,workspace:{scope:'ORGANIZATION',organization_id:orgA,group:false}});
  assert.equal(stale.status(),403);assert.equal((await stale.json()).error,'INVESTMENT_ACCESS_DENIED');
  const mismatch=await request('POST','/api/investments',{action:'SAVE',request_id:randomUUID(),workspace:{scope:'PERSONAL',organization_id:null,group:false},payload:terms('Rejected scope','ORGANIZATION',orgA,bankA)});
  assert.equal(mismatch.status(),400);assert.equal((await mismatch.json()).error,'INVESTMENT_SCOPE_MISMATCH');
  const unchanged=value(await owner.client.from('investment_contracts').select('status').eq('id',personalContract).single());assert.equal(unchanged.status,'DRAFT');
 });
 await check('CSV exports retain personal/company/group boundaries and refuse unrelated institutions',async()=>{
  for(const [scope,expected,excluded] of [
   ['scope=PERSONAL',[personalTx],[txA,txB]],
   [`scope=ORGANIZATION&organization_id=${orgA}`,[txA],[personalTx,txB]],
   [`scope=ORGANIZATION&organization_id=${orgB}`,[txB],[personalTx,txA]],
   [`scope=ORGANIZATION&organization_id=${orgA}&group=1`,[txA,txB],[personalTx]],
  ]){
   const response=await request('GET','/api/reports?type=transactions&'+scope);assert.equal(response.status(),200);
   const csv=await response.text();for(const id of expected)assert.ok(csv.includes(id));for(const id of excluded)assert.ok(!csv.includes(id));
  }
  assert.equal((await outsiderContext.request.get(app+`/api/reports?type=transactions&scope=ORGANIZATION&organization_id=${orgA}`)).status(),403);
 });
 await budgetScopeAcceptance({sql,owner,orgA,orgB,foreignOrg,request,check});
 report.routeOpening=await routeOpeningAcceptance({context:ownerContext,app,organizationId:orgA,otherOrganizationId:orgB,unavailableOrganizationId:foreignOrg,check});

 for(const locale of ['ar','en'])for(const width of [390,1440]){
  const ar=locale==='ar';await page.setViewportSize({width,height:1000});
  await check(`${locale} ${width}px personal navigation clears institutional state and keeps shared preferences`,async()=>{
   await page.goto(app+`/${locale}/assets?scope=PERSONAL&organization=${orgA}&level=GROUP`);
   await page.waitForFunction(()=>new URL(location.href).searchParams.get('scope')==='PERSONAL'&&!new URL(location.href).searchParams.has('organization'));
   await page.locator('.corp-workspace-scope button[aria-pressed="true"]').filter({hasText:ar?'شخصي':'Personal'}).waitFor();
   if(width===390)await page.getByRole('button',{name:ar?'القائمة الجانبية':'Sidebar menu',exact:true}).click();
   const toggle=page.locator('button[aria-controls="corp-assets-nav"]');
   if(await toggle.getAttribute('aria-expanded')!=='true')await toggle.click();
   const href=await page.locator('#corp-assets-nav a[href*="/financial-position"]').getAttribute('href');
   const url=new URL(href,app);assert.equal(url.searchParams.get('scope'),'PERSONAL');assert.equal(url.searchParams.has('organization'),false);
   const newTab=await ownerContext.newPage();await newTab.goto(url.href,{waitUntil:'domcontentloaded',timeout:90000});
   await newTab.locator('.corp-workspace-scope button[aria-pressed="true"]').filter({hasText:ar?'شخصي':'Personal'}).waitFor();await newTab.close();
   await page.goto(app+`/${locale}/settings/system?scope=PERSONAL`);
   await page.locator('.settings-tabs').waitFor();
   const links=await page.locator('.settings-tabs a').evaluateAll(nodes=>nodes.map(a=>a.getAttribute('href')));
   assert.equal(links.length,2);assert.ok(links.every(href=>href.includes('scope=PERSONAL')));assert.ok(links.some(href=>href.includes('/settings/personal-setup')));
   await page.screenshot({path:`${out}/personal-settings-${locale}-${width}.png`,fullPage:true});
  });
  await check(`${locale} ${width}px business navigation and back retain the selected company`,async()=>{
   await page.goto(app+`/${locale}/assets?scope=ORGANIZATION&organization=${orgA}&level=COMPANY`);
   const picker=page.locator('#corp-organization-controls select').first();
   await picker.waitFor();await page.waitForFunction(id=>document.querySelector('#corp-organization-controls select')?.value===id,orgA);
   await page.locator('.corp-workspace-scope button').filter({hasText:ar?'شخصي':'Personal'}).click();
   await page.waitForFunction(()=>new URL(location.href).searchParams.get('scope')==='PERSONAL'&&!new URL(location.href).searchParams.has('organization'));
   await page.goBack();
   await page.locator('.corp-workspace-scope button[aria-pressed="true"]').filter({hasText:ar?'مؤسسي':'Business'}).waitFor();
   await page.waitForFunction(id=>document.querySelector('#corp-organization-controls select')?.value===id,orgA);
  });
 }
 await check('An explicit unavailable company never falls back to another authorized company',async()=>{
  await page.goto(app+`/en/assets?scope=ORGANIZATION&organization=${foreignOrg}`);
  await page.locator('[data-workspace-organization-unavailable]').waitFor();
  const picker=page.locator('#corp-organization-controls select').first();assert.equal(await picker.inputValue(),'');
  await picker.selectOption(orgA);
  await page.waitForFunction(id=>new URL(location.href).searchParams.get('organization')===id,orgA);
  assert.equal(await page.locator('[data-workspace-organization-unavailable]').count(),0);
 });
 await check('Transaction form and cash choices reset on personal/company changes',async()=>{
  await page.setViewportSize({width:1440,height:1000});
  await page.goto(app+'/en/transactions?scope=PERSONAL');
  await page.getByRole('button',{name:'Add transaction',exact:true}).click();
  const asset=page.getByRole('combobox',{name:/^الأصل(?:\s|$)/});await asset.locator(`option[value="${personalAsset}"]`).waitFor({state:'attached'});await asset.selectOption(personalAsset);
  await page.getByRole('combobox',{name:/^النوع(?:\s|$)/}).selectOption('SALE');
  const proceeds=page.getByLabel('إيداع متحصلات البيع في');
  const ids=await proceeds.locator('option').evaluateAll(options=>options.map(o=>o.value).filter(Boolean));assert.deepEqual(ids,[personalBank]);
  await page.locator('.corp-workspace-scope button').filter({hasText:'Business'}).click();
  await page.locator('#transaction-entry').waitFor({state:'hidden'});
  await page.waitForFunction(()=>document.querySelector('#corp-organization-controls select')?.value);
  await page.getByRole('button',{name:'Add transaction',exact:true}).click();
  assert.equal(await page.getByRole('combobox',{name:/^الأصل(?:\s|$)/}).inputValue(),'');
  await page.locator('.corp-workspace-scope button').filter({hasText:'Personal'}).click();
  await page.locator('#transaction-entry').waitFor({state:'hidden'});
 });
 await check('Personal report hub and scoped print open under their intended banner',async()=>{
  await page.goto(app+'/en/financial-reports?scope=PERSONAL');
  await page.locator('.corp-workspace-scope button[aria-pressed="true"]').filter({hasText:'Personal'}).waitFor();
  await page.goto(app+'/en/reports/print?scope=PERSONAL');
  const personalReport=page.locator('main').last();
  assert.equal(await personalReport.locator('[role="alert"]').count(),0);assert.equal(await personalReport.locator('tbody tr').count(),0);
  assert.ok((await personalReport.innerText()).includes('Personal ·'));
  await page.goto(app+`/en/reports/print?scope=ORGANIZATION&organization=${orgA}&level=COMPANY`);
  await page.locator('.corp-workspace-scope button[aria-pressed="true"]').filter({hasText:'Business'}).waitFor();
  const report=page.locator('main').last(),text=await report.innerText();
  assert.equal(await report.locator('[role="alert"]').count(),0);assert.ok(text.includes('Organization · Scope Company A'));assert.ok(!text.includes('Scope Company B'));
  const values=await report.locator('[data-source-value]').evaluateAll(nodes=>nodes.map(node=>Number(node.dataset.sourceValue)));
  assert.ok(values.includes(12345));assert.ok(!values.includes(54321));
  await page.goto(app+`/en/reports/print?scope=ORGANIZATION&organization=${orgA}&level=GROUP`);
  const groupReport=page.locator('main').last();assert.equal(await groupReport.locator('[role="alert"]').count(),0);
  const groupValues=await groupReport.locator('[data-source-value]').evaluateAll(nodes=>nodes.map(node=>Number(node.dataset.sourceValue)));
  assert.ok(groupValues.includes(12345));assert.ok(groupValues.includes(54321));
 });
 await check('Old invoice bookmark retains the selected institutional context',async()=>{
  await page.goto(app+`/en/invoice-register?organization=${orgB}&level=COMPANY&month=2026-11`);
  const url=new URL(page.url());assert.equal(url.pathname,'/en/vat');assert.equal(url.searchParams.get('organization'),orgB);assert.equal(url.searchParams.get('section'),'unified');
 });
 assert.equal(checks.filter(result=>result.status==='failed').length,0,'Every independent module opening must pass');
 assert.deepEqual(pageErrors,[],'No uncaught browser exceptions');
 await outsiderContext.close();await ownerContext.close();
 report.status='passed';
}catch(error){
 report.status='failed';report.error=error instanceof Error?error.message:String(error);
 await captureFailurePage().catch(()=>{report.failurePage={unavailable:true};});
 process.exitCode=1;
}finally{
 report.finishedAt=new Date().toISOString();report.pageErrors=pageErrors;
 await writeFile(out+'/acceptance.json',JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({status:report.status,passed:checks.filter(c=>c.status==='passed').length,failed:checks.filter(c=>c.status==='failed').length,error:report.error??null}));
 await browser?.close();server?.kill('SIGTERM');
}
