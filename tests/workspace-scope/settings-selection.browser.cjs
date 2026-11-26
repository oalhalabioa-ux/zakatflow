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
const requests=[],writes=[],checks=[],pageErrors=[],serverLogs=[];
let server,browser,page,holdCatalog=false,holdUsers='',holdVat='',holdNotes=false,holdProfile=false,holdNumber=false,holdPolicy=false,holdInvite=false,holdSource=false,pending=[],profileSaves=[],noteReads=[],numberWrites=[],policyWrites=[],inviteWrites=[],sourceWrites=[];
const totals={salesBase:'0',salesGross:'0',purchaseBase:'0',purchaseVatBeforeRecovery:'0',outputTax:'0',inputTax:'0',taxPayable:'0',taxCredit:'0',salesNet:'0',purchaseNet:'0',paidAmount:'0',cashReservedAmount:'0',filingStatus:'NOT_FILED',dueDate:'',zeroRatedSales:'0',exemptSales:'0',outOfScopeSales:'0'};
function vatData(id,month){
 const year=month.slice(0,4),first=Math.floor((Number(month.slice(5))-1)/3)*3+1,last=first+2;
 const period={from:`${year}-${String(first).padStart(2,'0')}-01`,to:`${year}-${String(last).padStart(2,'0')}-${new Date(Date.UTC(Number(year),last,0)).getUTCDate()}`};
 const name=id===orgA?'Alpha':'Beta';
 return {profile:{id,organization_id:id,registration_status:'REGISTERED',filing_frequency:'QUARTERLY',standard_rate:15,period_start_month:1,registered_name:name+' registered',tax_registration_number:'300000000000003'},period,yearStart:year+'-01-01',periodSummary:null,periodTotals:totals,annualTotals:totals,documents:[{id:id+'-invoice',organization_id:id,document_number:name+' invoice',transaction_date:period.from,counterparty_name:name+' customer',document_type:'SALES',document_kind:'INVOICE',supply_type:'STANDARD',net_amount:100,tax_rate:15,tax_amount:15,gross_amount:115,currency:'SAR',in_tax_report:true}],service_catalog:['Fixture service']};
}
async function check(name,run){try{await run();checks.push({name,status:'passed'});console.log('PASS '+name);}catch(error){checks.push({name,status:'failed',error:String(error)});throw error;}}
async function settled(){await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));}
async function historyOrganization(id){await page.evaluate(id=>{const url=new URL(location.href);url.searchParams.delete('organization_id');url.searchParams.set('organization',id);history.pushState(null,'',url);dispatchEvent(new PopStateEvent('popstate'));},id);}
async function waitPending(){const until=Date.now()+15000;while(!pending.length){assert.ok(Date.now()<until,'Expected held request');await delay(25);}}
async function waitLength(items,length){const until=Date.now()+15000;while(items.length<length){assert.ok(Date.now()<until,'Expected held operation');await delay(25);}}
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
  requests.push({path:url.pathname,query:url.searchParams.toString(),method:req.method()});
  if(req.method()!=='GET'){
   const body=req.postDataJSON();writes.push({path:url.pathname,method:req.method(),body});
   assert.ok([orgA,orgB].includes(body.organization_id),'Synthetic writes must have an exact fixture company');
   if(url.pathname==='/api/organizations/permissions'&&body.action==='policy'&&holdPolicy){policyWrites.push(()=>route.fulfill({status:200,json:{ok:true}}));return;}
   if(url.pathname==='/api/organizations/users'&&req.method()==='POST'&&holdInvite){const number=inviteWrites.length+1;inviteWrites.push(()=>route.fulfill({status:200,json:{id:`80000000-0000-4000-8000-${String(number).padStart(12,'0')}`,invite_url:`https://example.test/invitations/fixture-${number}`}}));return;}
   if(url.pathname==='/api/vat'&&body.action==='save_profile'&&holdProfile){profileSaves.push(()=>route.fulfill({status:200,json:{...body,id:body.organization_id}}));return;}
   if(url.pathname==='/api/vat/invoice-numbering'&&holdNumber){numberWrites.push(()=>route.fulfill({status:200,json:{invoice_number:'HELD-0001'}}));return;}
   if(url.pathname==='/api/assessments/corporate/sources'){
    const sequence=sourceWrites.length+1,json={...body,id:`90000000-0000-4000-8000-${String(sequence).padStart(12,'0')}`,currency:'SAR',created_at:'2026-11-25T12:00:00Z',warnings:[],entries:[{field:body.model==='SAUDI'?'equity':'cash',id:'cash',name:`Capture ${sequence}`,value:456,source:'LIQUIDITY',date:body.assessment_date},...(body.model==='SIMPLE'?[{field:'inventory',id:'inventory',name:'Fixture inventory',value:789,source:'ASSET_BOOK_OR_SAVED_VALUE',date:body.assessment_date}]:[])]};
    const complete=()=>route.fulfill({status:200,json});sourceWrites.push({body,complete});if(holdSource)return;return complete();
   }
   return route.fulfill({status:500,json:{error:'UNEXPECTED_SYNTHETIC_WRITE'}});
  }
  const id=url.searchParams.get('organization_id')||url.searchParams.get('organization');let json=[];
  if(url.pathname==='/api/settings')json={profile:{name:'Synthetic actor',base_currency:'SAR'}};
  if(url.pathname==='/api/organizations')json=organizations;
  if(url.pathname==='/api/organizations/users')json={actor_role:'OWNER',actor_user_id:'actor',users:[{user_id:id+'-member',email:'fixture@example.test',name:id===orgA?'Alpha member':'Beta member',role:'VIEWER',status:'ACTIVE',created_at:'2026-01-01'}],invitations:[]};
  if(url.pathname==='/api/organizations/roles')json={roles:[]};
  if(url.pathname==='/api/organizations/permissions')json={roles:[],overrides:[],approval_policy:'OWNER_CONTROLLED'};
  if(url.pathname==='/api/currencies')json=[{code:'SAR',name_ar:'ريال سعودي',name_en:'Saudi riyal',decimals:2}];
  if(url.pathname==='/api/vat')json=vatData(id,url.searchParams.get('period_month'));
  if(url.pathname==='/api/vat/invoice-numbering')json={initialized:true,next_number:'FIXTURE-0001'};
  if(url.pathname==='/api/vat/contacts')json={can_manage:false,contacts:[{id:'70000000-0000-4000-8000-000000000001',organization_id:id,name:'Fixture customer',contact_type:'CUSTOMER',vat_number:null}]};
  if(url.pathname==='/api/vat/notes'){
   json={originals:[{...vatData(id,'2026-11').documents[0],document_number:holdNotes?'Stale original':'Current original',counterparty_contact_id:'70000000-0000-4000-8000-000000000001',recoverable_percent:100}]};
   if(holdNotes){noteReads.push(()=>route.fulfill({status:200,json}));return;}
  }
  if(url.pathname==='/api/liquidity')json={accounts:[],flows:[]};
  if(url.pathname==='/api/assessments/manual')json={rows:[]};
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
 await check('Team ignores a delayed policy response after A to B to A without unlocking a newer policy save',async()=>{
  await page.goto(`${origin}/en/users?scope=ORGANIZATION&organization=${orgA}`,{waitUntil:'domcontentloaded',timeout:90000});await page.locator('strong').filter({hasText:/^Alpha member$/}).waitFor();
  await page.getByRole('navigation',{name:'User and role management',exact:true}).getByRole('button',{name:'Governance & access',exact:true}).click();
  const policy=page.locator('label').filter({hasText:/^Approval policy/}).locator('select');
  holdPolicy=true;await policy.selectOption('ROLE_BASED');await waitLength(policyWrites,1);
  await historyOrganization(orgB);await page.locator('strong').filter({hasText:/^Beta member$/}).waitFor({state:'attached'});await historyOrganization(orgA);await page.locator('strong').filter({hasText:/^Alpha member$/}).waitFor({state:'attached'});
  assert.equal(await policy.inputValue(),'OWNER_CONTROLLED');await policy.selectOption('STRICT_SEGREGATION');await waitLength(policyWrites,2);
  await policyWrites[0]();await settled();assert.equal(await policy.inputValue(),'OWNER_CONTROLLED','Old A policy must not overwrite the current read');assert.equal(await selected().isDisabled(),true,'Old finally must not release a newer policy mutation');assert.equal(await page.getByText('Approval policy saved.',{exact:true}).count(),0);
  await policyWrites[1]();holdPolicy=false;await page.getByText('Approval policy saved.',{exact:true}).waitFor();assert.equal(await policy.inputValue(),'STRICT_SEGREGATION');assert.equal(await selected().isDisabled(),false);
 });
 await check('Team ignores an old invitation link after A to B to A and preserves the fresh invitation operation',async()=>{
  await page.goto(`${origin}/en/settings/team?scope=ORGANIZATION&organization=${orgA}`,{waitUntil:'domcontentloaded',timeout:90000});await page.locator('strong').filter({hasText:/^Alpha member$/}).waitFor();
  const form=page.locator('.team-invite-card form'),email=form.getByRole('textbox',{name:'Email',exact:true}),create=form.getByRole('button',{name:'Create invite',exact:true});
  holdInvite=true;await email.fill('old@example.test');await create.click();await waitLength(inviteWrites,1);
  await historyOrganization(orgB);await page.locator('strong').filter({hasText:/^Beta member$/}).waitFor();assert.equal(await email.inputValue(),'');await historyOrganization(orgA);await page.locator('strong').filter({hasText:/^Alpha member$/}).waitFor();
  await email.fill('fresh@example.test');await create.click();await waitLength(inviteWrites,2);await inviteWrites[0]();await settled();
  assert.equal(await page.getByRole('textbox',{name:'Invite link',exact:true}).count(),0,'The old invitation must not be displayed under the new company visit');assert.equal(await create.isDisabled(),true);assert.equal(await selected().isDisabled(),true);
  await inviteWrites[1]();holdInvite=false;const link=page.getByRole('textbox',{name:'Invite link',exact:true});await link.waitFor();assert.equal(await link.inputValue(),'https://example.test/invitations/fixture-2');await page.waitForFunction(()=>!document.querySelector('.team-invite-card button[type="submit"]')?.disabled);
  assert.equal(writes.filter(w=>w.path==='/api/organizations/invitations/email').length,0,'Synthetic invitation checks must never send email');
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
 await check('VAT ignores an old profile save after A to B to A and preserves the newer pending operation',async()=>{
  await page.goto(`${origin}/en/vat?scope=ORGANIZATION&organization=${orgA}`,{waitUntil:'domcontentloaded',timeout:90000});await waitSelected(orgA,'Company');
  async function submitProfile(){await page.getByRole('button',{name:'Edit registration profile',exact:true}).click();await page.locator('.vat-profile-form label').filter({hasText:/^Registration status/}).locator('select').selectOption('NOT_REGISTERED');await page.getByRole('button',{name:'Save registration',exact:true}).click();}
  holdProfile=true;await submitProfile();await waitLength(profileSaves,1);
  await historyOrganization(orgB);await page.getByRole('button',{name:'Edit registration profile',exact:true}).waitFor();await historyOrganization(orgA);await page.getByRole('button',{name:'Edit registration profile',exact:true}).waitFor();
  await submitProfile();await waitLength(profileSaves,2);await profileSaves[0]();await settled();
  assert.equal(await page.getByText('VAT settings saved.',{exact:true}).count(),0,'Old success must not enter the new selection');
  assert.equal(await selected('Company').isDisabled(),true,'Old finally must not release a newer pending save');
  await page.getByRole('button',{name:'Saving…',exact:true}).waitFor();await profileSaves[1]();holdProfile=false;await page.getByText('VAT settings saved.',{exact:true}).waitFor();assert.equal(await selected('Company').isDisabled(),false);
 });
 await check('VAT ignores delayed note originals after A to B to A and keeps the newly opened note',async()=>{
  await page.goto(`${origin}/en/vat?scope=ORGANIZATION&section=invoices&organization=${orgA}`,{waitUntil:'domcontentloaded',timeout:90000});await page.getByText('Alpha invoice',{exact:true}).waitFor();
  async function openCredit(){await page.locator('.vat-add-document').click();await page.getByRole('group',{name:'New document type',exact:true}).getByRole('button',{name:/^Credit note/}).click();}
  holdNotes=true;await openCredit();await waitLength(noteReads,1);
  await historyOrganization(orgB);await page.getByText('Beta invoice',{exact:true}).waitFor();await historyOrganization(orgA);await page.getByText('Alpha invoice',{exact:true}).waitFor();
  holdNotes=false;await openCredit();const originals=page.locator('.vat-document-form label').filter({hasText:/^Linked original invoice/}).locator('select');await originals.waitFor();assert.match(await originals.innerText(),/Current original/);
  await noteReads[0]();await settled();assert.match(await originals.innerText(),/Current original/);assert.doesNotMatch(await originals.innerText(),/Stale original/);
 });
 await check('VAT stops the invoice POST after a held number reservation crosses A to B to A',async()=>{
  await page.goto(`${origin}/en/vat?scope=ORGANIZATION&section=invoices&organization=${orgA}`,{waitUntil:'domcontentloaded',timeout:90000});await page.getByText('Alpha invoice',{exact:true}).waitFor();
  await page.locator('.vat-add-document').click();await page.getByRole('group',{name:'New document type',exact:true}).getByRole('button',{name:/^Invoice/}).click();
  const form=page.locator('.vat-document-form');await form.waitFor();await form.getByLabel('Customer / buyer',{exact:true}).selectOption('70000000-0000-4000-8000-000000000001');await form.getByLabel('Description for line 1',{exact:true}).selectOption('Fixture service');await form.getByLabel('Unit price',{exact:true}).fill('100');
  holdNumber=true;await form.getByRole('button',{name:'Save to register',exact:true}).click();await waitLength(numberWrites,1);
  await historyOrganization(orgB);await page.getByText('Beta invoice',{exact:true}).waitFor();await historyOrganization(orgA);await page.getByText('Alpha invoice',{exact:true}).waitFor();
  await numberWrites[0]();holdNumber=false;await settled();assert.equal(writes.filter(r=>r.path==='/api/vat'&&r.body.action==='add_document').length,0,'A stale reservation must never continue to document creation');assert.equal(await page.locator('.vat-document-form').count(),0,'A stale operation must not reopen its form');
 });
 await check('Corporate assessment opening and company or model switches create no source snapshots',async()=>{
  await page.goto(`${origin}/en/assessments?scope=ORGANIZATION&organization=${orgA}`,{waitUntil:'domcontentloaded',timeout:90000});await waitSelected(orgA,'Company');await page.getByRole('heading',{name:'Corporate zakat assessment',exact:true}).waitFor();
  await page.getByText('No saved manual assessments.',{exact:true}).waitFor();await page.locator('.corporate-zakat-sources').getByText('اختر «تحديث من السجلات»',{exact:false}).waitFor();
  await selected('Company').selectOption(orgB);await waitSelected(orgB,'Company');await selected('Company').selectOption(orgA);await waitSelected(orgA,'Company');
  await page.getByRole('button',{name:'Saudi corporate review',exact:true}).click();await page.getByRole('button',{name:'Corporate estimate',exact:true}).click();
  await page.getByLabel('Valuation date',{exact:true}).fill('2026-01-31');await page.getByLabel('Assessment period start',{exact:true}).fill('2026-01-01');await settled();
  assert.equal(sourceWrites.length,0,'Read-only opening, selection and date changes must never capture a source snapshot');
 });
 await check('Explicit corporate import pins its context and requires review before filling or replacing values',async()=>{
  const sources=page.locator('.corporate-zakat-sources'),cash=page.locator('label.manual-zakat-row').filter({hasText:'Cash and banks'}).locator('input'),inventory=page.locator('label.manual-zakat-row').filter({hasText:'Trading inventory'}).locator('input');
  await cash.fill('100');await sources.getByRole('button',{name:'تحديث من السجلات',exact:true}).click();await sources.getByRole('button',{name:'تعبئة البنود الفارغة',exact:true}).waitFor();
  assert.deepEqual(sourceWrites[0].body,{organization_id:orgA,model:'SIMPLE',assessment_date:'2026-01-31',period_start:'2026-01-01'});assert.equal(await cash.inputValue(),'100');assert.equal(await inventory.inputValue(),'','Fetching proposals must not apply them');
  await sources.getByRole('button',{name:'تعبئة البنود الفارغة',exact:true}).click();assert.equal(await cash.inputValue(),'100','Fill-empty keeps the manual amount');assert.equal(await inventory.inputValue(),'789');
  await sources.getByRole('button',{name:'تحديث من السجلات',exact:true}).click();await sources.getByRole('button',{name:'تطبيق القيم المعروضة من السجلات',exact:true}).click();assert.equal(await cash.inputValue(),'456','Explicit replace applies the reviewed source amount');
  await selected('Company').selectOption(orgB);await waitSelected(orgB,'Company');await selected('Company').selectOption(orgA);await waitSelected(orgA,'Company');await sources.getByText('يرتبط هذا الإدخال بنسخة محفوظة من السجلات.',{exact:false}).waitFor();assert.equal(await cash.inputValue(),'456');assert.equal(sourceWrites.length,2,'Reopening a draft must retain its snapshot reference without recapturing');
 });
 for(const change of ['company','model','date','period','currency'])await check(`Corporate source ignores a delayed response after ${change} leaves and returns to its original context`,async()=>{
  const sources=page.locator('.corporate-zakat-sources'),refresh=()=>sources.getByRole('button',{name:'تحديث من السجلات',exact:true});
  const old=sourceWrites.length;holdSource=true;await refresh().click();await waitLength(sourceWrites,old+1);
  if(change==='company'){await selected('Company').selectOption(orgB);await waitSelected(orgB,'Company');await selected('Company').selectOption(orgA);await waitSelected(orgA,'Company');}
  if(change==='model'){await page.getByRole('button',{name:'Saudi corporate review',exact:true}).click();await page.getByRole('button',{name:'Corporate estimate',exact:true}).click();}
  if(change==='date'){await page.getByLabel('Valuation date',{exact:true}).fill('2026-02-01');await page.getByLabel('Valuation date',{exact:true}).fill('2026-01-31');}
  if(change==='period'){await page.getByLabel('Assessment period start',{exact:true}).fill('2026-01-02');await page.getByLabel('Assessment period start',{exact:true}).fill('2026-01-01');}
  if(change==='currency'){await page.getByLabel('Currency of all entries',{exact:false}).fill('USD');await page.getByLabel('Currency of all entries',{exact:false}).fill('SAR');}
  await refresh().click();await waitLength(sourceWrites,old+2);assert.deepEqual(sourceWrites[old+1].body,sourceWrites[old].body,'Both manual requests are for the same identity after returning');
  await sourceWrites[old].complete();await settled();assert.equal(await sources.getByRole('button',{name:'تعبئة البنود الفارغة',exact:true}).count(),0,'Old response cannot inject a proposal');assert.equal(await sources.getAttribute('aria-busy'),'true','Old completion cannot unlock the newer request');assert.equal(await sources.getByRole('alert').count(),0);
  await sourceWrites[old+1].complete();holdSource=false;await sources.getByRole('button',{name:'تعبئة البنود الفارغة',exact:true}).waitFor();assert.equal(await sources.getAttribute('aria-busy'),'false');await sources.getByRole('button',{name:'إلغاء التحديث',exact:true}).click();
 });
 assert.deepEqual(pageErrors,[],'No client runtime errors');
})().catch(async error=>{console.error(error);process.exitCode=1;if(page)await page.screenshot({path:out+'/failure.png',fullPage:true}).catch(()=>{});}).finally(async()=>{
 await writeFile(out+'/results.json',JSON.stringify({checks,pageErrors,syntheticWrites:writes.map(w=>({path:w.path,method:w.method,action:w.body.action,organization_id:w.body.organization_id}))},null,2));await writeFile(out+'/next.log',serverLogs.join(''));
 if(browser)await browser.close();if(server){server.kill('SIGTERM');await delay(250);}
});
