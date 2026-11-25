// Synthetic loopback UI regression only; no authentication, persistence or RLS proof.
// Uses the same SCOPE_UI_BROWSER_MODULE / SCOPE_UI_CHROMIUM_MODULE inputs as ui-scope.browser.cjs.
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {mkdir,writeFile}=require('node:fs/promises');
const {pathToFileURL}=require('node:url');
const {setTimeout:delay}=require('node:timers/promises');
const {chromium}=require(process.env.SCOPE_UI_BROWSER_MODULE||'playwright-core');
const origin=process.env.SCOPE_UI_ORIGIN||'http://127.0.0.1:3150';
assert.equal(new URL(origin).hostname,'127.0.0.1','Loopback UI only');
const out=process.env.SCOPE_UI_ARTIFACTS||'/tmp/yaqeen-settings-selection';
const orgA='20000000-0000-4000-8000-000000000001',orgB='20000000-0000-4000-8000-000000000002',unavailable='20000000-0000-4000-8000-000000000099';
const organizations=[{id:orgA,name:'Alpha fixture',activity:'Alpha activity',country_code:'JO',base_currency:'SAR'},{id:orgB,name:'Beta fixture',activity:'Beta activity',country_code:'JO',base_currency:'SAR'}];
const requests=[],checks=[],pageErrors=[],serverLogs=[];
let server,browser,page,holdCatalog=false,holdUsers='',holdVat='',pending=[];
const totals={salesBase:'0',salesGross:'0',purchaseBase:'0',purchaseVatBeforeRecovery:'0',outputTax:'0',inputTax:'0',taxPayable:'0',taxCredit:'0',salesNet:'0',purchaseNet:'0',paidAmount:'0',cashReservedAmount:'0',filingStatus:'NOT_FILED',dueDate:'',zeroRatedSales:'0',exemptSales:'0',outOfScopeSales:'0'};
function vatData(id,month){
 const year=month.slice(0,4),first=Math.floor((Number(month.slice(5))-1)/3)*3+1,last=first+2;
 const period={from:`${year}-${String(first).padStart(2,'0')}-01`,to:`${year}-${String(last).padStart(2,'0')}-${new Date(Date.UTC(Number(year),last,0)).getUTCDate()}`};
 const name=id===orgA?'Alpha':'Beta';
 return {profile:{id,organization_id:id,registration_status:'REGISTERED',filing_frequency:'QUARTERLY',standard_rate:15,period_start_month:1,registered_name:name+' registered',tax_registration_number:'300000000000003'},period,yearStart:year+'-01-01',periodSummary:null,periodTotals:totals,annualTotals:totals,documents:[{id:id+'-invoice',organization_id:id,document_number:name+' invoice',transaction_date:period.from,counterparty_name:name+' customer',document_type:'SALES',document_kind:'INVOICE',supply_type:'STANDARD',net_amount:100,tax_rate:15,tax_amount:15,gross_amount:115,currency:'SAR',in_tax_report:true}],service_catalog:[]};
}
async function check(name,run){try{await run();checks.push({name,status:'passed'});console.log('PASS '+name);}catch(error){checks.push({name,status:'failed',error:String(error)});throw error;}}
async function settled(){await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));}
async function historyOrganization(id){await page.evaluate(id=>{const url=new URL(location.href);url.searchParams.delete('organization_id');url.searchParams.set('organization',id);history.pushState(null,'',url);dispatchEvent(new PopStateEvent('popstate'));},id);}
async function waitPending(){const until=Date.now()+15000;while(!pending.length){assert.ok(Date.now()<until,'Expected held request');await delay(25);}}
async function release(){const held=pending;pending=[];await Promise.all(held.map(fn=>fn()));}
const selected=(label='Organization')=>page.locator('#corp-organization-controls').getByRole('combobox',{name:label,exact:true});
async function waitSelected(id,label='Organization'){await page.waitForFunction(({id,label})=>document.querySelector(`#corp-organization-controls select[aria-label="${label}"]`)?.value===id,{id,label});}

(async()=>{
 await mkdir(out,{recursive:true});
 if(process.env.SCOPE_UI_START_SERVER==='1'){
  server=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','-H','127.0.0.1','-p',new URL(origin).port],{env:{...process.env,NEXT_PUBLIC_SUPABASE_URL:'',NEXT_PUBLIC_SUPABASE_ANON_KEY:'',SUPABASE_SERVICE_ROLE_KEY:'',NEXT_PUBLIC_APP_URL:origin,NEXT_PUBLIC_APP_ENV:'test',NEXT_TELEMETRY_DISABLED:'1',FINANCIAL_BUDGET_UI_QA:'false'},stdio:['ignore','pipe','pipe']});
  for(const stream of [server.stdout,server.stderr])stream.on('data',data=>{serverLogs.push(String(data));if(serverLogs.length>100)serverLogs.shift();});
  let ready=false;for(let i=0;i<100;i++){try{if((await fetch(origin+'/en/login',{signal:AbortSignal.timeout(1500)})).ok){ready=true;break;}}catch{}await delay(300);}assert.ok(ready,'Local Next must start');
 }
 const launch={headless:true};if(process.env.SCOPE_UI_CHROMIUM_MODULE){const binary=(await import(pathToFileURL(process.env.SCOPE_UI_CHROMIUM_MODULE).href)).default;launch.executablePath=await binary.executablePath();launch.args=binary.args;}
 browser=await chromium.launch(launch);const context=await browser.newContext({viewport:{width:1440,height:1000}});
 await context.addInitScript(({orgB})=>{localStorage.setItem('zf-theme','yaqeen-business');localStorage.setItem('zf-workspace-scope','ORGANIZATION');sessionStorage.setItem('zf-liquidity-org',orgB);localStorage.setItem('zf-liquidity-org',orgB);localStorage.setItem('zf-workspace-company-level','COMPANY');},{orgB});
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());if(url.origin!==origin)return route.abort('blockedbyclient');if(!url.pathname.startsWith('/api/'))return route.continue();
  requests.push({path:url.pathname,query:url.searchParams.toString(),method:req.method()});assert.equal(req.method(),'GET','Selection probes must not write');
  const id=url.searchParams.get('organization_id')||url.searchParams.get('organization');let json=[];
  if(url.pathname==='/api/settings')json={profile:{name:'Synthetic actor',base_currency:'SAR'}};
  if(url.pathname==='/api/organizations')json=organizations;
  if(url.pathname==='/api/organizations/users')json={actor_role:'OWNER',actor_user_id:'actor',users:[{user_id:id+'-member',email:'fixture@example.test',name:id===orgA?'Alpha member':'Beta member',role:'VIEWER',status:'ACTIVE',created_at:'2026-01-01'}],invitations:[]};
  if(url.pathname==='/api/organizations/roles')json={roles:[]};
  if(url.pathname==='/api/organizations/permissions')json={roles:[],overrides:[],approval_policy:'OWNER_CONTROLLED'};
  if(url.pathname==='/api/currencies')json=[{code:'SAR',name_ar:'ريال سعودي',name_en:'Saudi riyal',decimals:2}];
  if(url.pathname==='/api/vat')json=vatData(id,url.searchParams.get('period_month'));
  if(url.pathname==='/api/liquidity')json={accounts:[],flows:[]};
  const complete=()=>route.fulfill({status:200,json});
  if(holdCatalog&&url.pathname==='/api/organizations'||holdUsers===id&&url.pathname==='/api/organizations/users'||holdVat===id&&url.pathname==='/api/vat'){pending.push(complete);return;}
  return complete();
 });
 page=await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',error=>pageErrors.push(error.message));
 await check('Settings hook validates aliases, clears history transitions and rejects explicit unavailable companies',async()=>{
  for(const key of ['organization','organization_id']){
   await page.goto(`${origin}/en/settings/regulatory?scope=ORGANIZATION&${key}=${orgA}`,{waitUntil:'domcontentloaded',timeout:90000});await waitSelected(orgA);await page.getByText('Activity: Alpha activity',{exact:true}).waitFor();
  }
  holdCatalog=true;await historyOrganization(orgB);await waitPending();await settled();assert.equal(await page.getByText('Activity: Alpha activity',{exact:true}).count(),0,'Old settings must clear before the next catalog resolves');
  holdCatalog=false;await release();await waitSelected(orgB);await page.getByText('Activity: Beta activity',{exact:true}).waitFor();
  await historyOrganization(unavailable);await page.getByRole('alert').filter({hasText:'Unable to access this organization.'}).waitFor();assert.equal(await page.locator('[data-regulatory-workspace]').count(),0);
  await historyOrganization(orgA);await waitSelected(orgA);await page.getByText('Activity: Alpha activity',{exact:true}).waitFor();
 });
 for(const route of ['users','settings/team'])await check(`Team ${route} uses one banner picker and clears users during history, invalid selection and recovery`,async()=>{
  await page.goto(`${origin}/en/${route}?scope=ORGANIZATION&organization_id=${orgA}`,{waitUntil:'domcontentloaded',timeout:90000});await waitSelected(orgA);await page.locator('strong').filter({hasText:/^Alpha member$/}).waitFor();
  assert.equal(await page.getByRole('combobox',{name:'Organization',exact:true}).count(),1);
  holdUsers=orgB;await historyOrganization(orgB);await waitPending();await waitSelected(orgB);await settled();assert.equal(await page.locator('strong').filter({hasText:/^Alpha member$/}).count(),0,'Previous team must clear while next team loads');
  holdUsers='';await release();await page.locator('strong').filter({hasText:/^Beta member$/}).waitFor();
  const start=requests.length;await historyOrganization(unavailable);await waitSelected('');await page.locator('[data-workspace-organization-unavailable]').waitFor();await settled();
  assert.equal(await page.locator('strong').filter({hasText:/^Beta member$/}).count(),0);assert.equal(new URL(page.url()).searchParams.get('organization'),unavailable);
  assert.equal(requests.slice(start).filter(r=>r.path==='/api/organizations/users').length,0,'Invalid explicit team must not read another company');
  await selected().selectOption(orgA);await page.locator('strong').filter({hasText:/^Alpha member$/}).waitFor();assert.equal(new URL(page.url()).searchParams.get('organization'),orgA);
 });
 await check('VAT aliases keep exact company and clear old invoices through delayed history reads and invalid recovery',async()=>{
  for(const key of ['organization','organization_id']){
   const start=requests.length;await page.goto(`${origin}/en/vat?scope=ORGANIZATION&section=invoices&${key}=${orgA}`,{waitUntil:'domcontentloaded',timeout:90000});await waitSelected(orgA,'Company');await page.getByText('Alpha invoice',{exact:true}).waitFor();
   assert.ok(requests.slice(start).filter(r=>r.path==='/api/vat').every(r=>new URLSearchParams(r.query).get('organization_id')===orgA),'URL must beat remembered Beta');
  }
  holdVat=orgB;await historyOrganization(orgB);await waitPending();await waitSelected(orgB,'Company');await settled();
  assert.equal(await page.getByText('Alpha invoice',{exact:true}).count(),0,'Previous invoices must clear while next company loads');
  holdVat='';await release();await page.getByText('Beta invoice',{exact:true}).waitFor();
  const start=requests.length;await historyOrganization(unavailable);await waitSelected('','Company');await settled();
  assert.equal(await page.getByText('Beta invoice',{exact:true}).count(),0);assert.equal(new URL(page.url()).searchParams.get('organization'),unavailable);
  assert.equal(requests.slice(start).filter(r=>r.path==='/api/vat').length,0,'Unavailable company must not read substitute VAT');
  await selected('Company').selectOption(orgA);await page.getByText('Alpha invoice',{exact:true}).waitFor();assert.equal(new URL(page.url()).searchParams.get('organization'),orgA);
 });
 assert.deepEqual(pageErrors,[],'No client runtime errors');
})().catch(async error=>{console.error(error);process.exitCode=1;if(page)await page.screenshot({path:out+'/failure.png',fullPage:true}).catch(()=>{});}).finally(async()=>{
 await writeFile(out+'/results.json',JSON.stringify({checks,pageErrors},null,2));await writeFile(out+'/next.log',serverLogs.join(''));
 if(browser)await browser.close();if(server){server.kill('SIGTERM');await delay(250);}
});
