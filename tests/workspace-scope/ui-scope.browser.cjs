// Rendered UI acceptance with synthetic API routes. This does not verify Auth,
// RLS, persisted data or deployment; acceptance.mjs covers the real local stack.
// SCOPE_UI_BROWSER_MODULE: absolute playwright-core module path.
// SCOPE_UI_CHROMIUM_MODULE: optional absolute @sparticuz/chromium entry path.
// SCOPE_UI_START_SERVER=1 starts/stops Next in this process's loopback namespace.
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const {mkdir,writeFile} = require('node:fs/promises');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {setTimeout:delay} = require('node:timers/promises');
const {chromium} = require(process.env.SCOPE_UI_BROWSER_MODULE || 'playwright-core');

const origin = process.env.SCOPE_UI_ORIGIN || 'http://127.0.0.1:3120';
assert.equal(new URL(origin).hostname, '127.0.0.1', 'Loopback UI only');
const out = process.env.SCOPE_UI_ARTIFACTS || '/tmp/yaqeen-scope-ui';
const orgA = '20000000-0000-4000-8000-000000000001';
const orgB = '20000000-0000-4000-8000-000000000002';
const unavailable = '20000000-0000-4000-8000-000000000099';
const personalBank = '30000000-0000-4000-8000-000000000001';
const bankA = '30000000-0000-4000-8000-000000000002';
const bankB = '30000000-0000-4000-8000-000000000003';
const organizations = [{id:orgA,name:'Mock Alpha',base_currency:'SAR',organization_kind:'HOLDING',sort_order:10},{id:orgB,name:'Mock Beta',base_currency:'SAR',organization_kind:'SUBSIDIARY',sort_order:20,parent_organization_id:orgA}];
const fixtureAssets=[orgA,orgB].map((id,index)=>({id:`31000000-0000-4000-8000-00000000000${index+1}`,name:index?'Beta fixture gold':'Alpha fixture gold',asset_type:'GOLD',ownership_scope:'ORGANIZATION',organization_id:id,currency:'SAR',unit:'g',is_zakatable:false,current_quantity:1,current_cost_value:100,current_value_currency:'SAR',lifecycle_status:'ACTIVE',lots:[]}));
const terms = (name,organization_id) => ({name,instrument:'DEPOSIT',ownership_scope:organization_id?'ORGANIZATION':'PERSONAL',organization_id,entity_id:null,cost_center_id:null,party_name:'Synthetic bank',currency:'SAR',principal:1000,face_value:1000,fees:0,annual_rate:5,start_date:'2026-01-01',maturity_date:'2027-01-01',interest_basis:'ACT_365',zakat_basis:'HIJRI_354',zakat_rate:0,zakat_base:1000,zakat_treatment:'INVESTOR',zakat_assessment_mode:'INTERNAL',zakat_coverage_from:'',zakat_coverage_to:'',zakat_coverage_reference:'',inflation_rate:0,fx_rate:1,funding_account_id:organization_id===orgA?bankA:organization_id===orgB?bankB:personalBank,reference:'SYNTHETIC-UI',notes:''});
const contracts = [
 {id:'40000000-0000-4000-8000-000000000001',status:'DRAFT',version:1,terms:terms('Personal fixture deposit',null)},
 {id:'40000000-0000-4000-8000-000000000002',status:'DRAFT',version:1,terms:terms('Alpha fixture deposit',orgA)},
 {id:'40000000-0000-4000-8000-000000000003',status:'DRAFT',version:1,terms:terms('Beta fixture deposit',orgB)},
];
const planFor = (organization_id,year) => ({id:organization_id===orgA?'50000000-0000-4000-8000-000000000001':'50000000-0000-4000-8000-000000000002',organization_id,resolved_organization_id:organization_id,organization_name:organizations.find(o=>o.id===organization_id)?.name,name:'Synthetic saved plan',fiscal_year:year,currency:'SAR',scenario:'BASE',status:'DRAFT',cost_center:'HQ',opening_cash:0,minimum_cash_target:0,assumptions:{actual_through_month:0},notes:'',lines:[{id:'60000000-0000-4000-8000-000000000001',category:'REVENUE',name:'الإيرادات التشغيلية',line_type:'OPERATING',sort_order:10,monthly_budget:Array(12).fill(organization_id===orgA?101:202),monthly_actual:Array(12).fill(0),monthly_forecast:Array(12).fill(organization_id===orgA?101:202)}]});
const requests=[],writes=[],checks=[],pageErrors=[];
let browser,server,page,holdNextSave=false,pendingSave=null;
let holdDebtCatalog=false,pendingDebtCatalog=null;
let debtOperationFixtures=false,holdDebtWritePath='',pendingDebtWrite=null;
const debtWrites=[];
const fixtureName=id=>id===orgA?'Alpha':id===orgB?'Beta':'Personal';
const fixtureParty=id=>({id:id===orgA?'81000000-0000-4000-8000-000000000001':'81000000-0000-4000-8000-000000000002',name:fixtureName(id)+' fixture party',party_type:'EMPLOYEE'});
const fixtureLoan=(id,kind='EMPLOYEE_ADVANCE')=>({id:id===orgA?'82000000-0000-4000-8000-000000000001':'82000000-0000-4000-8000-000000000002',organization_id:id,organization_name:organizations.find(o=>o.id===id)?.name,financial_event_id:'83000000-0000-4000-8000-000000000001',counterparty_id:fixtureParty(id).id,account_id:id===orgA?bankA:bankB,entity_id:null,kind,mode:'NEW',side:'RECEIVABLE',status:'COMMITTED',currency:'SAR',base_currency:'SAR',exchange_rate:1,principal:1000,event_date:'2026-01-01',reference:fixtureName(id)+' loan reference',description:fixtureName(id)+' fixture loan',schedule:[{amount:1000,due_date:'2026-12-01'}],installments:[]});
const fixtureParticipation=id=>({...fixtureLoan(id,'LOAN'),id:id===orgA?'84000000-0000-4000-8000-000000000001':'84000000-0000-4000-8000-000000000002',state:'DRAFT',project:fixtureName(id)+' fixture participation',capital:1000,start_date:'2026-01-01',maturity_date:null,investor_profit_pct:50,investor_loss_pct:100,capital_treatment:'FINANCING',accounting_basis:'Synthetic accounting basis',loss_terms:'Synthetic loss terms for this contract',exit_terms:'Synthetic exit terms for this contract',summary:{received:0,managed:0,profitDue:0,returnDue:0,lossAllocated:0,profitDeclared:0,settled:0,due:0,pending:0},movements:[]});
const fixtureDebt=(id,side='RECEIVABLE')=>({id:id===orgA?'85000000-0000-4000-8000-000000000001':id===orgB?'85000000-0000-4000-8000-000000000002':'85000000-0000-4000-8000-000000000003',partyKey:fixtureParty(id).id,partyName:fixtureParty(id).name,organizationId:id,entityId:null,side,currency:'SAR',amount:100,dueDate:'2026-10-15',date:'2026-01-01',description:fixtureName(id)+' fixture followup',source:'DEBT_CONTRACTS',category:'O_AR_EMPLOYEE',reference:fixtureName(id)+' debt reference'});
const serverLogs=[];
async function check(name,run){
 if(process.env.SCOPE_UI_CHECK&&!process.env.SCOPE_UI_CHECK.split('|').some(filter=>name.includes(filter)))return;
 console.log('CHECK '+name);
 try{await run();checks.push({name,status:'passed'});console.log('PASS '+name);}
 catch(error){checks.push({name,status:'failed',error:String(error)});throw error;}
}
async function changeHistory(scope,organization){
 await page.evaluate(({scope,organization})=>{
  const url=new URL(location.href);url.searchParams.set('scope',scope);
  if(scope==='ORGANIZATION'){url.searchParams.set('organization',organization);url.searchParams.set('level','COMPANY');}
  else{url.searchParams.delete('organization');url.searchParams.delete('level');}
  history.pushState(null,'',url);dispatchEvent(new PopStateEvent('popstate'));
 },{scope,organization});
}
async function waitCompany(id){
 await page.waitForFunction(id=>document.querySelector('#corp-organization-controls select[aria-label="الشركة"]')?.value===id,id);
}
async function newDeposit(name){
 await page.getByRole('button',{name:'وديعة جديدة',exact:true}).click();
 const form=page.getByRole('dialog',{name:'وديعة جديدة',exact:true});
 await form.getByLabel('اسم وديعة بنكية',{exact:true}).fill(name);
 await form.getByLabel('البنك المودَع لديه',{exact:true}).fill('UI fixture bank');
 await form.getByLabel('مبلغ الإيداع',{exact:true}).fill('1000');
 await form.getByLabel('معدل عائد الوديعة السنوي %',{exact:true}).fill('5');
 return form;
}

(async()=>{
 await mkdir(out,{recursive:true});
 if(process.env.SCOPE_UI_START_SERVER==='1'){
  server=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','-H','127.0.0.1','-p',new URL(origin).port],{env:{...process.env,NEXT_PUBLIC_SUPABASE_URL:'',NEXT_PUBLIC_SUPABASE_ANON_KEY:'',SUPABASE_SERVICE_ROLE_KEY:'',NEXT_PUBLIC_APP_URL:origin,NEXT_PUBLIC_APP_ENV:'test',NEXT_TELEMETRY_DISABLED:'1',FINANCIAL_BUDGET_UI_QA:'false'},stdio:['ignore','pipe','pipe']});
  for(const stream of [server.stdout,server.stderr])stream.on('data',data=>{serverLogs.push(String(data));if(serverLogs.length>100)serverLogs.shift();});
  let ready=false;for(let i=0;i<90;i++){try{if((await fetch(origin+'/ar/login',{signal:AbortSignal.timeout(1500)})).ok){ready=true;break;}}catch{}await delay(300);}
  assert.ok(ready,'Local Next must start');
 }
 const launch={headless:true};
 if(process.env.SCOPE_UI_CHROMIUM_MODULE){const binary=(await import(pathToFileURL(process.env.SCOPE_UI_CHROMIUM_MODULE).href)).default;launch.executablePath=await binary.executablePath();launch.args=binary.args;}
 browser=await chromium.launch(launch);
 const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
 await context.addInitScript(({orgB})=>{localStorage.setItem('zf-theme','yaqeen-business');localStorage.setItem('zf-liquidity-org',orgB);sessionStorage.setItem('zf-liquidity-org',orgB);localStorage.setItem('zf-workspace-company-level','COMPANY');},{orgB});
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.origin!==origin)return route.abort('blockedbyclient');
  if(!url.pathname.startsWith('/api/'))return route.continue();
  requests.push({path:url.pathname,query:url.searchParams.toString(),method:request.method()});
  if(debtOperationFixtures&&request.method()==='POST'&&['/api/debt-contracts','/api/participation-contracts','/api/debt-collection','/api/advances'].includes(url.pathname)){
   debtWrites.push({path:url.pathname,query:url.searchParams.toString(),body:request.postDataJSON()});
   const complete=()=>route.fulfill({status:200,json:{id:'86000000-0000-4000-8000-000000000001',ok:true}});
   if(holdDebtWritePath===url.pathname){holdDebtWritePath='';pendingDebtWrite=complete;return;}
   return complete();
  }
  let json=[];
  if(url.pathname==='/api/settings')json={profile:{name:'Synthetic UI actor',base_currency:'SAR'}};
  if(url.pathname==='/api/organizations')json=organizations;
  if(url.pathname==='/api/assets/catalog')json={organizations,entities:[],cost_centers:[],classes:[],types:[],suppliers:[],base_currency:'SAR'};
  if(url.pathname==='/api/assets')json=fixtureAssets;
  if(url.pathname==='/api/financial-register')json={asOf:'2026-11-25',baseCurrency:'SAR',organizations,organizationIds:[url.searchParams.get('organization_id')],entities:[],accounts:[],cashMovements:[],debts:[],debtMovements:[],assets:[],warnings:[]};
  if(url.pathname==='/api/personal-contracts')json={contracts:[]};
  if(url.pathname==='/api/participation-contracts')json={contracts:[],parties:[],accounts:[],permissions:{},canCreate:true};
  if(url.pathname==='/api/debt-catalog'){
   const complete=()=>route.fulfill({status:200,json:{organizations}});
   if(holdDebtCatalog){pendingDebtCatalog=complete;return;}
   return complete();
  }
  if(url.pathname==='/api/debt-overview'||url.pathname==='/api/debt-collection')json={asOf:'2026-11-25',baseCurrency:'SAR',organizations,debts:[],movements:[],followups:[],members:[],userId:'synthetic',canWrite:{},warnings:[]};
  if(url.pathname==='/api/debt-contracts')json={organization:organizations.find(o=>o.id===url.searchParams.get('organization_id')),contracts:[],parties:[],accounts:[],permissions:{}};
  if(debtOperationFixtures){
   const id=url.searchParams.get('organization_id'),party=fixtureParty(id),catalog={organization:organizations.find(o=>o.id===id),contracts:[fixtureLoan(id,url.searchParams.get('kind')||'EMPLOYEE_ADVANCE')],parties:[party],accounts:[{id:id===orgA?bankA:bankB,name:fixtureName(id)+' bank',currency:'SAR',entity_id:null}],entities:[],partyTypes:[],permissions:{'financial_core.create':true},canCreate:true};
   if(url.pathname==='/api/debt-contracts')json=url.searchParams.has('contract_id')?{status:'COMMITTED',approved:false,actions:['CANCEL']}:catalog;
   if(url.pathname==='/api/participation-contracts')json={...catalog,contracts:[fixtureParticipation(id)]};
   if(url.pathname==='/api/debt-overview'||url.pathname==='/api/debt-collection')json={asOf:'2026-11-25',baseCurrency:'SAR',organizations,debts:[fixtureDebt(id,url.pathname==='/api/debt-overview'?'SUPPLIER_ADVANCE':'RECEIVABLE')],movements:[],followups:[],members:[],userId:'synthetic',canWrite:{[orgA]:true,[orgB]:true,PERSONAL:true},warnings:[]};
   if(url.pathname==='/api/advances')json={baseCurrency:'SAR',parties:[party],accounts:catalog.accounts,entities:[],advances:[],obligations:[],flows:[],canCreate:true,requests:[{id:'87000000-0000-4000-8000-000000000001',description:fixtureName(id)+' pending advance',event_date:'2026-01-01',status:'COMMITTED',approved:false,actions:['CANCEL']}]};
  }
  if(url.pathname==='/api/assessments/manual')json={rows:[]};
  if(url.pathname==='/api/investments'){
   if(request.method()==='POST'){
    const body=request.postDataJSON();writes.push(body);
    const saved={id:`40000000-0000-4000-8000-${String(contracts.length+1).padStart(12,'0')}`,status:'DRAFT',version:1,terms:body.payload};
    const complete=async()=>{contracts.push(saved);await route.fulfill({status:200,json:saved});};
    if(holdNextSave){holdNextSave=false;pendingSave=complete;return;}
    return complete();
   }
   const personal=url.searchParams.get('scope')==='PERSONAL',organization=url.searchParams.get('organization_id');
   json={contracts:contracts.filter(c=>personal?!c.terms.organization_id:c.terms.organization_id===organization),operations:[],personalAccounts:personal?[{id:personalBank,name:'Personal bank',currency:'SAR'}]:[],organizationAccounts:personal?[]:[{id:organization===orgA?bankA:bankB,name:organization===orgA?'Alpha bank':'Beta bank',organization_id:organization,currency:'SAR'}],baseCurrency:'SAR'};
  }
  if(url.pathname==='/api/organizations/cost-centers'){
   const id=url.searchParams.get('organization_id');json=[{id:id===orgA?'70000000-0000-4000-8000-000000000001':'70000000-0000-4000-8000-000000000002',organization_id:id,code:'HQ',name:id===orgA?'Alpha admin':'Beta admin',center_type:'ADMIN',active:true}];
  }
  if(url.pathname==='/api/budget-plans')json=(url.searchParams.get('group')==='1'?[orgA,orgB]:[url.searchParams.get('organization_id')]).map(id=>planFor(id,Number(url.searchParams.get('fiscal_year'))));
  if(url.pathname.startsWith('/api/budget-plans/'))json=planFor(url.searchParams.get('organization_id'),new Date().getFullYear()+1);
  if(url.pathname==='/api/reports')return route.fulfill({status:200,contentType:'text/csv',body:'id,scope,organization_id\nsynthetic,'+url.searchParams.get('scope')+','+(url.searchParams.get('organization_id')||'')});
  return route.fulfill({status:200,json});
 });
 page=await context.newPage();page.setDefaultTimeout(25000);page.on('pageerror',error=>pageErrors.push(error.message));
 const debtGet=(api,id)=>page.waitForResponse(response=>{const u=new URL(response.url());return u.pathname===api&&u.searchParams.get('organization_id')===id&&response.request().method()==='GET'&&!u.searchParams.has('contract_id')&&!u.searchParams.has('context');});
 const debtReadsSince=(start,api)=>requests.slice(start).filter(r=>r.method==='GET'&&r.path===api&&!new URLSearchParams(r.query).has('contract_id')&&!new URLSearchParams(r.query).has('context'));
 const settleUi=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 async function openDebtRoute(route,api,id=orgA){debtOperationFixtures=true;const received=debtGet(api,id);await page.goto(origin+'/en/'+route+(route.includes('?')?'&':'?')+'scope=ORGANIZATION&organization='+id+'&level=COMPANY',{waitUntil:'domcontentloaded',timeout:90000});assert.equal((await received).status(),200);await page.waitForFunction(id=>document.querySelector('#corp-organization-controls select[aria-label="Company"]')?.value===id,id);await settleUi();}
 async function switchDebt(api,id){const received=debtGet(api,id);await changeHistory('ORGANIZATION',id);assert.equal((await received).status(),200);await page.waitForFunction(id=>document.querySelector('#corp-organization-controls select[aria-label="Company"]')?.value===id,id);await settleUi();}
 async function heldDebtWrite(api,click){holdDebtWritePath=api;pendingDebtWrite=null;await click();const deadline=Date.now()+25000;while(!pendingDebtWrite){assert.ok(Date.now()<deadline,'Synthetic write must reach the held route');await delay(25);}}
 async function completeDebtWrite(api){const received=page.waitForResponse(response=>new URL(response.url()).pathname===api&&response.request().method()==='POST');await pendingDebtWrite();pendingDebtWrite=null;assert.equal((await received).status(),200);await settleUi();}
 async function loanDetails(){await page.getByRole('button',{name:'التفاصيل والإجراءات',exact:true}).click();const dialog=page.getByRole('dialog',{name:'تفاصيل السجل وإجراءاته',exact:true});await dialog.getByRole('button',{name:'تعديل المسودة',exact:true}).waitFor();return dialog;}
 async function participationDetails(){await page.getByRole('button',{name:'التفاصيل والإجراءات',exact:true}).click();const dialog=page.getByRole('dialog',{name:'تفاصيل عقد المشاركة',exact:true});await dialog.getByRole('button',{name:'تعديل المسودة',exact:true}).waitFor();return dialog;}
 await check('Debt operation loans clear old edits and ignore a delayed child save after A to B to A',async()=>{
  await openDebtRoute('employee-advances','/api/debt-contracts');
  await (await loanDetails()).getByRole('button',{name:'تعديل المسودة',exact:true}).click();
  let form=page.getByRole('dialog',{name:'سند قرض أو سلفة',exact:true});await form.getByLabel('بيان السند',{exact:true}).fill('Original Alpha save');
  await heldDebtWrite('/api/debt-contracts',()=>form.getByRole('button',{name:'حفظ السند للاعتماد',exact:true}).click());
  assert.equal(debtWrites.at(-1).body.organization_id,orgA);assert.equal(debtWrites.at(-1).body.action,'EDIT');
  await switchDebt('/api/debt-contracts',orgB);assert.equal(await form.count(),0,'Old-company edit must close on switch');await page.getByText('Beta fixture loan',{exact:true}).waitFor();
  await switchDebt('/api/debt-contracts',orgA);await (await loanDetails()).getByRole('button',{name:'تعديل المسودة',exact:true}).click();
  form=page.getByRole('dialog',{name:'سند قرض أو سلفة',exact:true});await form.getByLabel('بيان السند',{exact:true}).fill('New Alpha draft remains');
  const start=requests.length;await completeDebtWrite('/api/debt-contracts');assert.equal(await form.getByLabel('بيان السند',{exact:true}).inputValue(),'New Alpha draft remains');assert.deepEqual(debtReadsSince(start,'/api/debt-contracts'),[],'Late child onSaved must not reload the new context');
 });
 await check('Debt operation loans ignore a delayed parent action after A to B',async()=>{
  await openDebtRoute('employee-advances','/api/debt-contracts');await (await loanDetails()).getByRole('button',{name:'حذف المسودة',exact:true}).click();
  await heldDebtWrite('/api/debt-contracts',()=>page.getByRole('dialog',{name:'تأكيد حذف المسودة',exact:true}).getByRole('button',{name:'تأكيد الحذف',exact:true}).click());
  assert.equal(debtWrites.at(-1).body.organization_id,orgA);assert.equal(debtWrites.at(-1).body.action,'DELETE');
  await switchDebt('/api/debt-contracts',orgB);const dialog=await loanDetails();assert.equal(await page.getByRole('dialog',{name:'تأكيد حذف المسودة',exact:true}).count(),0,'Delete confirmation must not transfer to Beta');
  const start=requests.length;await completeDebtWrite('/api/debt-contracts');assert.equal(await dialog.getByRole('heading',{name:'Beta fixture loan',exact:true}).count(),1);assert.deepEqual(debtReadsSince(start,'/api/debt-contracts'),[],'Late parent action must not reload Alpha into Beta');
 });
 await check('Debt operation participation clears retained edits and rejects an old A to B to A completion',async()=>{
  await openDebtRoute('loans?product=PARTICIPATION','/api/participation-contracts');await (await participationDetails()).getByRole('button',{name:'تعديل المسودة',exact:true}).click();
  const edit=page.getByRole('dialog',{name:'عقد استثمار ومشاركة',exact:true});await edit.getByLabel('المشروع / محفظة المشاركة',{exact:true}).fill('Old Alpha edit');
  await switchDebt('/api/participation-contracts',orgB);assert.equal(await edit.count(),0,'Participation edit must not remain owned by Alpha');
  await switchDebt('/api/participation-contracts',orgA);await (await participationDetails()).getByRole('button',{name:'حذف المسودة',exact:true}).click();
  await heldDebtWrite('/api/participation-contracts',()=>page.getByRole('dialog',{name:'تأكيد حذف مسودة العقد',exact:true}).getByRole('button',{name:'تأكيد الحذف',exact:true}).click());
  assert.equal(debtWrites.at(-1).body.organization_id,orgA);assert.equal(debtWrites.at(-1).body.action,'DELETE');
  await switchDebt('/api/participation-contracts',orgB);await participationDetails();assert.equal(await page.getByRole('dialog',{name:'تأكيد حذف مسودة العقد',exact:true}).count(),0);
  await switchDebt('/api/participation-contracts',orgA);await (await participationDetails()).getByRole('button',{name:'حذف المسودة',exact:true}).click();
  const start=requests.length;await completeDebtWrite('/api/participation-contracts');assert.equal(await page.getByRole('dialog',{name:'تأكيد حذف مسودة العقد',exact:true}).count(),1,'Old DELETE completion must not dismiss a new confirmation');assert.deepEqual(debtReadsSince(start,'/api/participation-contracts'),[]);
 });
 await check('Debt operation collection preserves the new follow-up after A to B to A',async()=>{
  await openDebtRoute('debt-collection','/api/debt-collection');await page.getByRole('button',{name:'المتابعة والتفاصيل',exact:true}).click();let dialog=page.getByRole('dialog',{name:'متابعة الذمة',exact:true});await dialog.getByLabel('الملاحظة',{exact:true}).fill('Original Alpha followup');
  await heldDebtWrite('/api/debt-collection',()=>dialog.getByRole('button',{name:'حفظ المتابعة',exact:true}).click());assert.equal(debtWrites.at(-1).body.organization_id,orgA);
  await switchDebt('/api/debt-collection',orgB);assert.equal(await dialog.count(),0);await page.getByText('Beta fixture followup',{exact:true}).waitFor();
  await switchDebt('/api/debt-collection',orgA);await page.getByRole('button',{name:'المتابعة والتفاصيل',exact:true}).click();dialog=page.getByRole('dialog',{name:'متابعة الذمة',exact:true});await dialog.getByLabel('الملاحظة',{exact:true}).fill('New Alpha followup remains');
  const start=requests.length;await completeDebtWrite('/api/debt-collection');assert.equal(await dialog.locator('textarea').inputValue(),'New Alpha followup remains');assert.deepEqual(debtReadsSince(start,'/api/debt-collection'),[],'Old follow-up must not reload or close the new form');
 });
 await check('Debt operation advances ignores a removed modal callback when company B is active',async()=>{
  await openDebtRoute('debt-advances','/api/debt-overview');await page.getByRole('button',{name:'تسجيل / تخصيص دفعة',exact:true}).click();let dialog=page.getByRole('dialog',{name:'الدفعات المقدمة',exact:true});await dialog.getByRole('button',{name:'الطلبات والاعتماد',exact:true}).click();await dialog.getByLabel('سبب الإجراء / الملاحظة',{exact:true}).fill('Synthetic cancellation');
  await heldDebtWrite('/api/advances',()=>dialog.getByRole('button',{name:'إلغاء الطلب',exact:true}).click());assert.equal(new URLSearchParams(debtWrites.at(-1).query).get('organization_id'),orgA);
  await switchDebt('/api/debt-overview',orgB);assert.equal(await dialog.count(),0);await page.getByText('Beta fixture followup',{exact:true}).waitFor();
  await page.getByRole('button',{name:'تسجيل / تخصيص دفعة',exact:true}).click();dialog=page.getByRole('dialog',{name:'الدفعات المقدمة',exact:true});await dialog.getByRole('button',{name:'الطلبات والاعتماد',exact:true}).click();await dialog.getByLabel('سبب الإجراء / الملاحظة',{exact:true}).fill('New Beta note remains');
  const start=requests.length,oldModalRead=debtGet('/api/advances',orgA);await completeDebtWrite('/api/advances');assert.equal((await oldModalRead).status(),200);await settleUi();
  assert.equal(await dialog.getByLabel('سبب الإجراء / الملاحظة',{exact:true}).inputValue(),'New Beta note remains');assert.deepEqual(debtReadsSince(start,'/api/debt-overview'),[],'Removed modal callback must not load Alpha balances into Beta');assert.equal(await page.locator('tbody').getByText('Alpha fixture followup',{exact:true}).count(),0);
 });
 debtOperationFixtures=false;
 for(const [module,route,api] of [
  ['overview','debts','/api/debt-overview'],
  ['collection','debt-collection','/api/debt-collection'],
  ['loans','employee-advances','/api/debt-contracts'],
  ['participation','loans?product=PARTICIPATION','/api/participation-contracts'],
  ['advances','debt-advances','/api/debt-overview'],
 ])await check('Debt company selection validates the catalog, URL priority and unavailable recovery: '+module,async()=>{
  const href=(key,id)=>origin+'/en/'+route+(route.includes('?')?'&':'?')+'scope=ORGANIZATION&'+key+'='+id+'&level=COMPANY';
  const readsSince=start=>requests.slice(start).filter(r=>r.path===api);
  const read=id=>page.waitForResponse(response=>new URL(response.url()).pathname===api&&new URL(response.url()).searchParams.get('organization_id')===id&&response.request().method()==='GET');
  let start=requests.length;holdDebtCatalog=true;pendingDebtCatalog=null;
  await page.goto(href('organization',orgA),{waitUntil:'domcontentloaded',timeout:90000});
  const deadline=Date.now()+25000;while(!pendingDebtCatalog){assert.ok(Date.now()<deadline,'Debt catalog request must start');await delay(25);}
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert.deepEqual(readsSince(start),[],'No company data request may precede catalog validation');
  let received=read(orgA);holdDebtCatalog=false;await pendingDebtCatalog();pendingDebtCatalog=null;assert.equal((await received).status(),200);
  const picker=page.locator('#corp-organization-controls select[aria-label="Company"]');
  await page.waitForFunction(id=>document.querySelector('#corp-organization-controls select[aria-label="Company"]')?.value===id,orgA);
  assert.ok(readsSince(start).every(r=>new URLSearchParams(r.query).get('organization_id')===orgA),'Explicit URL must beat remembered Beta');
  assert.equal(await page.evaluate(()=>localStorage.getItem('zf-liquidity-org')),orgB,'Restoration must not overwrite the deliberate company preference');
  start=requests.length;
  await page.goto(href('organization',unavailable),{waitUntil:'domcontentloaded',timeout:90000});
  await page.locator('[data-workspace-organization-unavailable]').waitFor();
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert.equal(await picker.inputValue(),'');assert.deepEqual(readsSince(start),[],'Unavailable explicit company must not load a substitute');
  assert.equal(new URL(page.url()).searchParams.get('organization'),unavailable);
  received=read(orgB);await picker.selectOption(orgB);assert.equal((await received).status(),200);
  assert.equal(new URL(page.url()).searchParams.get('organization'),orgB);
  start=requests.length;received=read(orgA);
  await page.goto(href('organization_id',orgA),{waitUntil:'domcontentloaded',timeout:90000});assert.equal((await received).status(),200);
  assert.ok(readsSince(start).every(r=>new URLSearchParams(r.query).get('organization_id')===orgA),'Explicit legacy alias must beat remembered Beta');
 });
 await check('Asset company selection keeps an unavailable URL unresolved and permits deliberate recovery',async()=>{
  await page.goto(origin+`/en/assets?scope=ORGANIZATION&organization=${unavailable}`,{waitUntil:'domcontentloaded',timeout:90000});
  await page.locator('[data-workspace-organization-unavailable]').waitFor();
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const picker=page.locator('#corp-organization-controls select[aria-label="Company"]');
  assert.equal(await picker.inputValue(),'');
  assert.equal(await page.getByText('Alpha fixture gold',{exact:false}).count(),0);
  assert.equal(await page.getByText('Beta fixture gold',{exact:false}).count(),0);
  assert.equal(new URL(page.url()).searchParams.get('organization'),unavailable);
  await picker.selectOption(orgA);
  await page.locator('.asset-report-table').getByText('Alpha fixture gold',{exact:false}).waitFor();
  assert.equal(await page.getByText('Beta fixture gold',{exact:false}).count(),0);
  assert.equal(await page.locator('[data-workspace-organization-unavailable]').count(),0);
  await page.goto(origin+'/en/assets?scope=ORGANIZATION',{waitUntil:'domcontentloaded',timeout:90000});
  await page.waitForFunction(id=>document.querySelector('#corp-organization-controls select[aria-label="Company"]')?.value===id,orgB);
  await page.locator('.asset-report-table').getByText('Beta fixture gold',{exact:false}).waitFor();
  assert.equal(await page.getByText('Alpha fixture gold',{exact:false}).count(),0);
 });
 await check('Asset company dashboard reads only the explicit authorized company and never an unavailable one',async()=>{
  let start=requests.length;
  await page.goto(origin+`/en/assets/dashboard?scope=ORGANIZATION&organization=${orgA}`,{waitUntil:'domcontentloaded',timeout:90000});
  await page.locator('.org-assets-dashboard[aria-busy="false"] .org-assets-links').waitFor();
  let reads=requests.slice(start).filter(r=>r.path==='/api/financial-register');
  assert.ok(reads.length>0);assert.ok(reads.every(r=>new URLSearchParams(r.query).get('organization_id')===orgA));
  start=requests.length;
  await page.goto(origin+`/en/assets/dashboard?scope=ORGANIZATION&organization_id=${unavailable}`,{waitUntil:'domcontentloaded',timeout:90000});
  await page.locator('[data-workspace-organization-unavailable]').waitFor();
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert.equal(await page.locator('#corp-organization-controls select[aria-label="Company"]').inputValue(),'');
  assert.equal(requests.slice(start).filter(r=>r.path==='/api/financial-register').length,0);
 });
 await check('Asset company reports honor an explicit alias and hide every company for an unavailable selection',async()=>{
  await page.goto(origin+`/en/reports?scope=ORGANIZATION&organization_id=${orgA}`,{waitUntil:'domcontentloaded',timeout:90000});
  await page.locator('.asset-reports .transaction-table-wrap').getByText('Alpha fixture gold',{exact:true}).waitFor();
  assert.equal(await page.locator('.asset-reports').getByText('Beta fixture gold',{exact:true}).count(),0);
  assert.equal(await page.locator('#corp-organization-controls select[aria-label="Company"]').inputValue(),orgA);
  await page.goto(origin+`/en/reports?scope=ORGANIZATION&organization=${unavailable}`,{waitUntil:'domcontentloaded',timeout:90000});
  await page.locator('[data-workspace-organization-unavailable]').waitFor();
  await page.locator('.asset-report-caption').waitFor();
  assert.equal(await page.locator('#corp-organization-controls select[aria-label="Company"]').inputValue(),'');
  assert.equal(await page.locator('.asset-reports').getByText('Alpha fixture gold',{exact:true}).count(),0);
  assert.equal(await page.locator('.asset-reports').getByText('Beta fixture gold',{exact:true}).count(),0);
 });
 await check('Personal investments remove stale company URL and request only personal data',async()=>{
  await page.goto(origin+`/ar/investments?scope=PERSONAL&organization=${orgA}&level=GROUP&investment_view=deposits`,{waitUntil:'domcontentloaded',timeout:90000});
  await page.locator('.investment-table').getByText('Personal fixture deposit',{exact:true}).waitFor();
  assert.equal(await page.locator('.investment-table').getByText('Alpha fixture deposit',{exact:true}).count(),0);
  assert.equal(await page.locator('#corp-organization-controls select[aria-label="الشركة"]').count(),0);
  await page.waitForFunction(()=>!new URL(location.href).searchParams.has('organization'));
  const call=requests.filter(r=>r.path==='/api/investments').at(-1);assert.equal(call.query,'scope=PERSONAL');
 });
 await check('Explicit company URL beats stored preference; open drafts reset on A to B',async()=>{
  await page.goto(origin+`/ar/investments?scope=ORGANIZATION&organization=${orgA}&level=COMPANY&investment_view=deposits`,{waitUntil:'domcontentloaded',timeout:90000});
  await waitCompany(orgA);await page.locator('.investment-table').getByText('Alpha fixture deposit',{exact:true}).waitFor();
  const draft=await newDeposit('Unsaved Alpha');
  assert.equal(await draft.locator('select').filter({has:page.locator('option[value="PERSONAL"]')}).count(),0);
  await changeHistory('ORGANIZATION',orgB);
  await waitCompany(orgB);await page.locator('.investment-table').getByText('Beta fixture deposit',{exact:true}).waitFor();
  assert.equal(await page.getByRole('dialog',{name:'وديعة جديدة',exact:true}).count(),0);
  assert.equal(await page.locator('.investment-table').getByText('Alpha fixture deposit',{exact:true}).count(),0);
  const form=await newDeposit('Saved Beta draft');
  assert.equal(await form.locator('label').filter({hasText:'حساب التمويل'}).locator('select').inputValue(),bankB);
  await form.getByRole('button',{name:'حفظ المسودة',exact:true}).click();
  await page.locator('.investment-table').getByText('Saved Beta draft',{exact:true}).waitFor();
  assert.deepEqual(writes.at(-1).workspace,{scope:'ORGANIZATION',organization_id:orgB,group:false});
  assert.equal(writes.at(-1).payload.organization_id,orgB);
  assert.equal(writes.at(-1).payload.ownership_scope,'ORGANIZATION');
  await page.keyboard.press('Escape');
 });
 await check('Delayed investment save cannot clear a new draft after A to personal to A',async()=>{
  await changeHistory('ORGANIZATION',orgA);await waitCompany(orgA);await page.locator('.investment-table').getByText('Alpha fixture deposit',{exact:true}).waitFor();
  const form=await newDeposit('Delayed Alpha save');holdNextSave=true;
  await form.getByRole('button',{name:'حفظ المسودة',exact:true}).click();
  for(let i=0;i<100&&!pendingSave;i++)await delay(20);assert.ok(pendingSave,'Synthetic delayed write must start');
  await changeHistory('PERSONAL');await page.locator('.investment-table').getByText('Personal fixture deposit',{exact:true}).waitFor();
  await changeHistory('ORGANIZATION',orgA);await waitCompany(orgA);await page.locator('.investment-table').getByText('Alpha fixture deposit',{exact:true}).waitFor();
  const newer=await newDeposit('New Alpha draft stays');await pendingSave();pendingSave=null;
  await delay(200);
  assert.equal(await newer.getByLabel('اسم وديعة بنكية',{exact:true}).inputValue(),'New Alpha draft stays');
  assert.equal(await newer.getByRole('button',{name:'حفظ المسودة',exact:true}).isEnabled(),true);
  await page.screenshot({path:path.join(out,'investment-draft-scope.png'),fullPage:true});
  await page.keyboard.press('Escape');
 });
 await check('Operational CSV and printable links follow personal and exact company selection',async()=>{
  await page.goto(origin+`/ar/reports?scope=PERSONAL&organization=${orgA}&level=GROUP`,{waitUntil:'domcontentloaded',timeout:90000});
  const printable=page.getByRole('link',{name:'تقرير للطباعة',exact:true});await printable.waitFor();
  assert.equal(new URL(await printable.getAttribute('href'),origin).search,'?scope=PERSONAL');
  let download=page.waitForEvent('download');await page.locator('.premium-report-card').first().getByRole('button',{name:'CSV',exact:true}).click();await download;
  let q=new URLSearchParams(requests.filter(r=>r.path==='/api/reports').at(-1).query);assert.equal(q.get('scope'),'PERSONAL');assert.equal(q.has('organization_id'),false);
  await page.getByRole('button',{name:'مؤسسي',exact:true}).click();await waitCompany(orgB);
  await page.getByRole('combobox',{name:'الشركة',exact:true}).selectOption(orgA);await waitCompany(orgA);
  await page.waitForFunction(id=>{const a=[...document.querySelectorAll('a')].find(a=>a.textContent==='تقرير للطباعة');return a&&new URL(a.href).searchParams.get('organization')===id},orgA);
  const link=new URL(await printable.getAttribute('href'),origin);assert.equal(link.searchParams.get('scope'),'ORGANIZATION');assert.equal(link.searchParams.get('organization'),orgA);assert.equal(link.searchParams.get('level'),'COMPANY');
  download=page.waitForEvent('download');await page.locator('.premium-report-card').last().getByRole('button',{name:'CSV',exact:true}).click();await download;
  q=new URLSearchParams(requests.filter(r=>r.path==='/api/reports').at(-1).query);assert.equal(q.get('organization_id'),orgA);assert.equal(q.get('scope'),'ORGANIZATION');
 });
 await check('Budget reads company IDs and corporate assessments; never personal dashboard totals',async()=>{
  const start=requests.length;
  await page.goto(origin+`/ar/budget-planning?scope=ORGANIZATION&organization=${orgA}&level=COMPANY&tab=monthly`,{waitUntil:'domcontentloaded',timeout:90000});
  await waitCompany(orgA);
  await page.waitForFunction(()=>{const s=[...document.querySelectorAll('select')].find(s=>s.closest('label')?.textContent.includes('مركز التكلفة'));return s?.value==='HQ'&&!s.disabled});
  await page.getByRole('combobox',{name:'الشركة',exact:true}).selectOption(orgB);await waitCompany(orgB);
  const centers=page.locator('#corp-organization-controls label').filter({hasText:'مركز التكلفة'}).locator('select');await centers.selectOption('HQ');
  await page.getByRole('button',{name:/الزكاة والتوقيت/}).click();
  await page.getByText('لا يوجد احتساب مؤسسي معتمد بهذه العملة؛ يمكن إدخال تقدير يدوي.',{exact:true}).waitFor();
  const calls=requests.slice(start);assert.equal(calls.some(r=>r.path==='/api/dashboard'),false);
  for(const id of [orgA,orgB]){
   assert.ok(calls.some(r=>r.path==='/api/budget-plans'&&new URLSearchParams(r.query).get('organization_id')===id));
   assert.ok(calls.some(r=>r.path==='/api/assessments/manual'&&new URLSearchParams(r.query).get('organization_id')===id));
  }
  assert.ok(calls.filter(r=>r.path.startsWith('/api/budget-plans')).every(r=>new URLSearchParams(r.query).get('organization_id')));
  await page.screenshot({path:path.join(out,'budget-company-source.png'),fullPage:true});
 });
 await check('Budget browser history follows exact organizations and clears an unavailable selection',async()=>{
  await changeHistory('ORGANIZATION',orgA);await waitCompany(orgA);
  await changeHistory('ORGANIZATION',orgB);await waitCompany(orgB);
  await page.goBack();await waitCompany(orgA);
  await page.goForward();await waitCompany(orgB);
  const start=requests.length;
  await changeHistory('ORGANIZATION',unavailable);
  await page.waitForFunction(()=>document.querySelector('#corp-organization-controls select[aria-label="الشركة"]')?.value==='');
  assert.equal(await page.locator('#corp-organization-controls label').filter({hasText:'مركز التكلفة'}).locator('select').isEnabled(),false);
  assert.equal(requests.slice(start).some(r=>r.path==='/api/budget-plans'&&new URLSearchParams(r.query).get('organization_id')===unavailable),false);
 });
 await check('Initial budget group URL loads both authorized company details',async()=>{
  const start=requests.length;
  await page.goto(origin+`/ar/budget-planning?scope=ORGANIZATION&organization=${orgA}&level=GROUP&tab=monthly`,{waitUntil:'domcontentloaded',timeout:90000});
  await waitCompany(orgA);
  await page.waitForFunction(()=>{const s=[...document.querySelectorAll('select')].find(s=>s.closest('label')?.textContent.includes('مركز التكلفة'));return s?.value==='ALL'&&s.disabled});
  for(let i=0;i<100&&!requests.slice(start).some(r=>r.path.startsWith('/api/budget-plans/')&&new URLSearchParams(r.query).get('organization_id')===orgB);i++)await delay(20);
  for(const id of [orgA,orgB])assert.ok(requests.slice(start).some(r=>r.path.startsWith('/api/budget-plans/')&&new URLSearchParams(r.query).get('organization_id')===id));
 });
 await check('Unavailable explicit company cannot fall back to a remembered investment company',async()=>{
  const start=requests.length;
  await page.goto(origin+`/ar/investments?scope=ORGANIZATION&organization=${unavailable}&investment_view=deposits`,{waitUntil:'domcontentloaded',timeout:90000});
  await page.locator('[data-workspace-organization-unavailable]').waitFor();
  assert.equal(await page.getByRole('button',{name:'وديعة جديدة',exact:true}).isEnabled(),false);
  assert.equal(requests.slice(start).some(r=>r.path==='/api/investments'&&new URLSearchParams(r.query).get('scope')==='ORGANIZATION'),false);
 });
 assert.deepEqual(pageErrors,[],'No client runtime errors in mocked UI acceptance');
 console.log('PASS mocked Chromium UI scope acceptance: '+checks.length+' scenarios');
})().catch(async error=>{
 console.error(error);process.exitCode=1;
 if(page){await page.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});await writeFile(path.join(out,'failure-body.txt'),await page.locator('body').innerText().catch(()=>''));await writeFile(path.join(out,'failure-dialogs.json'),JSON.stringify(await page.locator('dialog').evaluateAll(dialogs=>dialogs.map(dialog=>({label:dialog.getAttribute('aria-label'),open:dialog.open,hidden:dialog.hidden,ariaHidden:dialog.getAttribute('aria-hidden'),inputs:[...dialog.querySelectorAll('input,textarea')].map(input=>({label:input.closest('label')?.textContent,value:input.value,disabled:input.disabled})),ancestors:[...(()=>{const nodes=[];for(let node=dialog.parentElement;node;node=node.parentElement)nodes.push({tag:node.tagName,hidden:node.hidden,ariaHidden:node.getAttribute('aria-hidden'),inert:node.inert});return nodes;})()]}))).catch(()=>[]),null,2));}
}).finally(async()=>{
 await writeFile(path.join(out,'result.json'),JSON.stringify({proof:'Synthetic API routes; real rendered local UI; no Auth/RLS/persistence/deployment claim',checks,pageErrors,requests,writes,debtWrites},null,2));
 if(browser)await browser.close();
 if(server){server.kill('SIGTERM');await writeFile(path.join(out,'next.log'),serverLogs.join(''));}
});
