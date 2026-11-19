// Issue #421 only. Runs in the disposable local Supabase + Chromium fixture.
// No real QA/Production user or billing value is modified.
import assert from 'node:assert/strict';

const marker='QA421';
const phase=(caseName,step)=>console.log('QA421_PHASE '+JSON.stringify({source:'disposable-local-Chromium',caseName,step}));
const synthetic={
 direct:{email:'billing-direct@qa.example.test',address:'QA test address — direct billing'},
 visited:{email:'billing-after-feasibility@qa.example.test',address:'QA test address — after feasibility'},
};

export async function runFeasibilityBillingAB({browser,cookies,appUrl,url,owner,outsider,headers,check,enableCompanyFeasibility}){
 const observations=[];
 async function newOrg(name){
  const r=await fetch(url+'/rest/v1/organizations',{
   method:'POST',headers:{...headers(owner),Prefer:'return=representation'},
   body:JSON.stringify({name,owner_user_id:owner.id})
  });
  assert.equal(r.status,201,'Disposable organization fixture failed '+await r.clone().text());
  const data=await r.json();
  assert.equal(data.length,1);
  return data[0].id;
 }
 async function runCase(caseName,visitFeasibility){
  const org=await newOrg(marker+' '+caseName+' Institution');
  const email=synthetic[caseName].email,address=synthetic[caseName].address;
  const context=await browser.newContext();
  await context.addCookies(cookies.map(c=>({name:c.name,value:c.value,url:appUrl})));
  const page=await context.newPage();
  page.setDefaultTimeout(12000);
  page.setDefaultNavigationTimeout(20000);
  const jsErrors=[],requests=[];
  page.on('pageerror',e=>jsErrors.push(String(e).slice(0,350)));
  // Fail a stalled navigation predictably; all fixtures are disposable.
  const caseGuard=setTimeout(()=>{
   phase(caseName,'case-timeout-150s');
   void context.close().catch(()=>{});
  },150000);
  caseGuard.unref();
  try{
   phase(caseName,'start');
   if(visitFeasibility){
    phase(caseName,'feasibility-personal-navigation');
    await page.goto(appUrl+'/en/feasibility?scope=PERSONAL&organization='+org+'&level=COMPANY');
    phase(caseName,'feasibility-personal-loaded');
    await page.getByRole('heading',{name:'Feasibility & project development',exact:true}).waitFor();
    const switcher=page.getByRole('group',{name:'Workspace scope'});
    const organizationPicker=page.getByRole('button',{name:'Choose organization from the main banner'});
    assert.equal(await organizationPicker.count(),0);
    // Open a personal QA study inside this disposable Chromium context;
    // opening the Feasibility module and switching scopes are the billing
    // integration variable. Company-study *creation* is tested separately
    // because an unexplained POST 403 must not suppress Billing A/B evidence.
    await page.getByRole('button',{name:'New study',exact:true}).click();
    await page.getByRole('textbox',{name:'New project name',exact:true}).fill('QA421 Personal draft');
    await page.getByRole('radio',{name:'Bottled-water factory',exact:true}).check();
    await page.getByRole('button',{name:'Add project +',exact:true}).click();
    await page.getByRole('heading',{name:'QA421 Personal draft',exact:true}).waitFor();
    const sidebar=page.locator('#corp-primary-nav');
    const sidebarSections=sidebar.getByRole('button',{name:'Feasibility & Project Development',exact:true});
    assert.equal(await sidebarSections.getAttribute('aria-expanded'),'false');
    assert.equal(await sidebar.getByRole('link',{name:'Feasibility & Project Development',exact:true}).count(),0);
    await sidebarSections.click();
    assert.equal(await sidebarSections.getAttribute('aria-expanded'),'true');
    const sidebarGroup=page.getByRole('group',{name:'Feasibility sections',exact:true});
    const studyTabs=page.getByRole('navigation',{name:'Study sections',exact:true});
    assert.deepEqual(await sidebarGroup.getByRole('button').allTextContents(),await studyTabs.getByRole('button').allTextContents());
    await sidebarGroup.getByRole('button',{name:'Investment',exact:true}).click();
    assert.equal(await studyTabs.getByRole('button',{name:'Investment',exact:true}).getAttribute('aria-current'),'page');
    await studyTabs.getByRole('button',{name:'Operations',exact:true}).click();
    assert.equal(await sidebarGroup.getByRole('button',{name:'Operations',exact:true}).getAttribute('aria-current'),'location');
    await sidebarSections.click();
    await studyTabs.getByRole('button',{name:'Investment',exact:true}).click();
    await page.getByLabel('Construction and buildings',{exact:true}).fill('24680');
    await page.reload();
    await page.getByRole('button',{name:'Investment',exact:true}).click();
    assert.equal(await page.getByLabel('Construction and buildings',{exact:true}).inputValue(),'24680');
    await page.getByRole('button',{name:'Operations',exact:true}).click();
    const collectionPeriod=page.getByLabel('Collection period (days)',{exact:true});
    await collectionPeriod.fill('45');
    await page.reload();
    await page.getByRole('button',{name:'Operations',exact:true}).click();
    assert.equal(await collectionPeriod.inputValue(),'45');
    await page.getByRole('button',{name:'Report and export',exact:true}).click();
    const report=page.getByRole('heading',{name:'Feasibility report',exact:true});
    await report.waitFor();
    const reportContents=page.getByRole('navigation',{name:'Report contents'});
    const fundingSection=page.locator('[data-report-section="funding"]');
    await reportContents.getByRole('link',{name:'Funding and shareholder loans'}).press('Enter');
    assert.equal(await fundingSection.evaluate(element=>document.activeElement===element),true);
    assert.equal(await reportContents.getByRole('link',{name:'Study notes'}).count(),0);
    const primaryReportAction=page.locator('.fs-royal-report-output button').first();
    assert.equal(await primaryReportAction.innerText(),'Print / PDF');
    assert.deepEqual(await page.locator('.fs-royal-report-summary-kpis small').allTextContents(),
     ['Economic investment','NPV','IRR','Readiness']);
    await page.emulateMedia({media:'print'});
    try{
     assert.equal(await report.isVisible(),true);
     assert.equal(await reportContents.isVisible(),false);
     assert.equal(await page.getByRole('heading',{name:'Project portfolio',exact:true}).isVisible(),false);
     assert.equal(await page.getByRole('button',{name:'Print / PDF',exact:true}).isVisible(),false);
     const pdf=await page.pdf({format:'A4',printBackground:true});
     assert.equal(pdf.subarray(0,5).toString(),'%PDF-');
    }finally{await page.emulateMedia({media:null});}
    phase(caseName,'feasibility-report-pdf-generated');
    await page.getByRole('button',{name:'Report export options',exact:true}).click();
    const exportDialog=page.getByRole('dialog');
    await exportDialog.getByRole('checkbox',{name:'Licences, tasks and risks',exact:true}).uncheck();
    const fundingOption=exportDialog.getByRole('checkbox',{name:'Funding and shareholder loans',exact:true});
    assert.ok(await fundingOption.getAttribute('aria-describedby'));
    assert.equal(await fundingOption.isChecked(),true);
    await fundingOption.press('Space');
    assert.equal(await fundingOption.isChecked(),false);
    const sectionOptions=exportDialog.getByRole('checkbox');
    const printSelection=exportDialog.getByRole('button',{name:'Print / PDF',exact:true});
    const selectedOptions=[];
    for(const checkbox of await sectionOptions.all()){
     if(await checkbox.isChecked()){
      selectedOptions.push(checkbox);
      await checkbox.uncheck();
     }
    }
    assert.equal(await printSelection.isDisabled(),true);
    for(const checkbox of selectedOptions)await checkbox.check();
    // Suppress the native dialog while checking Chromium's real print layout.
    const restorePrint=await page.evaluateHandle(()=>{
     const print=window.print;
     window.print=()=>{};
     return ()=>{window.print=print;window.dispatchEvent(new Event('afterprint'));};
    });
    try{
     await printSelection.click();
     await page.emulateMedia({media:'print'});
     assert.equal(await report.isVisible(),true);
     assert.equal(await page.locator('[data-report-section="governance"]').isVisible(),false);
     assert.equal(await page.locator('[data-report-section="funding"]').isVisible(),false);
     assert.equal(await page.locator('[data-report-section="ownership"]').isVisible(),true);
     assert.equal(await page.locator('[data-report-section="finance"]').isVisible(),true);
     const pdf=await page.pdf({format:'A4',printBackground:true});
     assert.equal(pdf.subarray(0,5).toString(),'%PDF-');
    }finally{
     await restorePrint.evaluate(restore=>restore());
     await restorePrint.dispose();
     await page.emulateMedia({media:null});
    }
    phase(caseName,'feasibility-selected-pdf-omits-governance');
    phase(caseName,'personal-study-opened-and-reloaded');
    const firstCompanyRead=page.waitForResponse(r=>{
     const parsed=new URL(r.url());
     return parsed.pathname==='/api/feasibility/organization-projects'&&
      parsed.searchParams.get('organization')===org&&r.request().method()==='GET';
    });
    phase(caseName,'topbar-switch-to-organization');
    await switcher.getByRole('button',{name:'Business',exact:true}).click();
    await page.waitForFunction(()=>new URLSearchParams(location.search).get('scope')==='ORGANIZATION');
    const companyGet=await firstCompanyRead;
    phase(caseName,'organization-projects-get-'+companyGet.status());
    assert.equal(companyGet.status(),200,'Organization Feasibility GET must be authorized');
    const companyCreate=page.getByRole('button',{name:'New study',exact:true});
    await companyCreate.waitFor({state:'visible'});
    await organizationPicker.waitFor({state:'visible'});
    // The default organization trial includes feasibility after the trial policy update.
    await page.getByRole('button',{name:'Create first study',exact:true}).waitFor();
    assert.equal(await companyCreate.isEnabled(),true);
    assert.equal(await page.getByRole('button',{name:/QA421 Personal draft/}).count(),0,
     'Personal study must not appear in organization portfolio');
    phase(caseName,'topbar-switch-back-to-personal');
    await switcher.getByRole('button',{name:'Personal',exact:true}).click();
    await page.waitForFunction(()=>new URLSearchParams(location.search).get('scope')==='PERSONAL');
    await organizationPicker.waitFor({state:'hidden'});
    await page.getByRole('button',{name:'Overview',exact:true}).click();
    const personalDraft=page.getByRole('button',{name:/QA421 Personal draft/}).first();
    await personalDraft.waitFor();
    await personalDraft.click();
    phase(caseName,'personal-study-reopened');
    const secondCompanyRead=page.waitForResponse(r=>{
     const parsed=new URL(r.url());
     return parsed.pathname==='/api/feasibility/organization-projects'&&
      parsed.searchParams.get('organization')===org&&r.request().method()==='GET';
    });
    phase(caseName,'topbar-return-to-organization');
    await switcher.getByRole('button',{name:'Business',exact:true}).click();
    await page.waitForFunction(()=>new URLSearchParams(location.search).get('scope')==='ORGANIZATION');
    const reloadedStudies=await secondCompanyRead;
    phase(caseName,'organization-projects-return-get-'+reloadedStudies.status());
    assert.equal(reloadedStudies.status(),200,'Organization Feasibility GET after scope return must succeed');
    assert.equal(new URL(page.url()).searchParams.get('organization'),org);
    assert.equal(await page.getByRole('button',{name:/QA421 Personal draft/}).count(),0,
     'Personal study must stay separate from organization on return');
    phase(caseName,'feasibility-navigation-and-portfolio-isolation-passed');
   }
   phase(caseName,'billing-navigation');
   const getBefore=page.waitForResponse(r=>r.url()===appUrl+'/api/organizations'&&r.request().method()==='GET');
   await page.goto(appUrl+'/en/billing?organization='+org);
   const initial=await getBefore;
   phase(caseName,'billing-initial-get-'+initial.status());
   assert.equal(initial.status(),200,'Initial organizations GET must succeed');
   const initialRows=await initial.json();
   assert.ok(Array.isArray(initialRows)&&initialRows.some(x=>x.id===org),'Selected organization not returned after route navigation');
   await page.getByRole('button',{name:'Invoices & payments',exact:true}).click();
   const form=page.locator('.billing-identity-form');
   await form.waitFor();
   await form.getByLabel('Legal organization name',{exact:true}).fill(marker+' Legal '+caseName);
   await form.locator('select').first().selectOption('SA');
   await form.getByLabel('Registered address',{exact:true}).fill(address);
   await form.getByLabel('Billing email',{exact:true}).fill(email);
   const written=page.waitForResponse(r=>r.url()===appUrl+'/api/organizations'&&r.request().method()==='PATCH');
   phase(caseName,'billing-patch-start');
   await form.getByRole('button',{name:'Save details',exact:true}).click();
   const reply=await written;
   phase(caseName,'billing-patch-response-'+reply.status());
   const patch=JSON.parse(reply.request().postData()||'{}');
   requests.push({method:'PATCH',status:reply.status(),scoped:patch.id===org,fields:Object.keys(patch).sort()});
   assert.equal(reply.status(),200,'Billing PATCH rejected on '+caseName);
   assert.equal(patch.id,org,'Billing PATCH targeted wrong organization');
   assert.equal(patch.contact_email,email,'Missing billing email in PATCH payload');
   assert.equal(patch.registered_address,address,'Missing address in PATCH payload');
   const saved=await reply.json();
   assert.equal(saved.id,org,'Billing save returned wrong organization');
   assert.equal(saved.contact_email,email,'Billing PATCH response did not return email');
   assert.equal(saved.registered_address,address,'Billing PATCH response did not return address');
   await page.getByText('Organization details saved.',{exact:true}).waitFor();
   const reloaded=page.waitForResponse(r=>r.url()===appUrl+'/api/organizations'&&r.request().method()==='GET');
   await page.reload();
   const get=await reloaded;
   phase(caseName,'billing-reload-get-'+get.status());
   requests.push({method:'GET',status:get.status(),scoped:true,fields:['id','contact_email','registered_address']});
   assert.equal(get.status(),200,'Billing reload GET failed');
   const rows=await get.json(),savedRow=Array.isArray(rows)?rows.find(x=>x.id===org):null;
   assert.ok(savedRow,'Billing reload GET lost authorized organization');
   assert.equal(savedRow.contact_email,email,'Billing email not persisted in GET');
   assert.equal(savedRow.registered_address,address,'Billing address not persisted in GET');
   await page.getByRole('button',{name:'Billing details',exact:true}).click();
   await page.waitForFunction(({email,address})=>{
    const form=document.querySelector('.billing-identity-form');
    return !!form &&
     form.querySelector('input[type=email]')?.value===email &&
     Array.from(form.querySelectorAll('input')).some(x=>x.value===address);
   },{email,address},{timeout:10000});
   assert.equal(await page.getByLabel('Billing email',{exact:true}).inputValue(),email);
   assert.equal(await page.getByLabel('Registered address',{exact:true}).inputValue(),address);
   assert.equal(new URL(page.url()).searchParams.get('organization'),org);
   assert.deepEqual(jsErrors,[], 'Unexpected browser errors in '+caseName+': '+jsErrors.join(' | '));
   phase(caseName,'email-and-address-persisted');
   observations.push({caseName,visitedFeasibility:visitFeasibility,organizationScoped:true,
    ownerAuthorized:true,post:200,get:200,emailPersisted:true,addressPersisted:true,
    requests,jsErrorCount:0});
  }finally{
   clearTimeout(caseGuard);
   await context.close().catch(()=>{});
  }
 }
 await check('issue 421: authorized direct Billing write/reload without Feasibility visit',
  ()=>runCase('direct',false));
 await check('issue 421: Personal ⇄ Business Feasibility, open study, then Billing write/reload',
  ()=>runCase('visited',true));
 // Separate corporate create regression: test and diagnose it without
 // hiding or invalidating the completed Billing/Feasibility A/B comparison.
 await check('issue 421: isolate corporate project POST authorization and origin',async()=>{
  const caseName='corporate-create';
  const org=await newOrg(marker+' Corporate POST fixture');
  // Keep the POST same-origin under the local standalone hostname.
  // Do not weaken the application's CSRF/origin protection.
  const corporateAppUrl='http://localhost:3000';
  const context=await browser.newContext();
  await context.addCookies(cookies.map(c=>({name:c.name,value:c.value,url:corporateAppUrl})));
  const page=await context.newPage();
  page.setDefaultTimeout(12000);
  page.setDefaultNavigationTimeout(20000);
  try{
   const companyAPI=corporateAppUrl+'/api/feasibility/organization-projects?organization='+org;
   const trialAccess=await context.request.get(companyAPI);
   assert.equal(trialAccess.status(),200);
   assert.equal((await trialAccess.json()).canWrite,true,'An active company trial includes feasibility');
   phase(caseName,'organization-navigation');
   const got=page.waitForResponse(r=>{
    const u=new URL(r.url());
    return u.pathname==='/api/feasibility/organization-projects'&&
     u.searchParams.get('organization')===org&&r.request().method()==='GET';
   });
   await page.goto(corporateAppUrl+'/en/feasibility?scope=ORGANIZATION&organization='+org+'&level=COMPANY');
   const get=await got;
   assert.equal(get.status(),200,'Owner company read must be granted before create');
   const grants=await get.json();
   assert.equal(grants.canWrite,true,'Owner company create entitlement must be active');
   phase(caseName,'owner-read-and-write-entitlement-verified');
   await page.getByRole('button',{name:'New study',exact:true}).click();
   const name=page.getByRole('textbox',{name:'New project name',exact:true});
   await name.fill('QA421 Corporate create regression');
   await page.getByRole('radio',{name:'Bottled-water factory',exact:true}).check();
   const btn=page.getByRole('button',{name:'Add project +',exact:true});
   await btn.waitFor({state:'visible'});
   await page.waitForFunction(()=>{
    const el=[...document.querySelectorAll('button')].find(b=>b.textContent?.trim()==='Add project +');
    return !!el&&!el.disabled;
   },null,{timeout:12000});
   const posted=page.waitForResponse(r=>{
    const u=new URL(r.url());
    return u.pathname==='/api/feasibility/organization-projects'&&
     u.searchParams.get('organization')===org&&r.request().method()==='POST';
   },{timeout:12000});
   await btn.click();
   const response=await posted, req=response.request();
   const requestHeaders=await req.allHeaders();
   const responseHeaders=await response.allHeaders();
   const diagnostics={
    source:'disposable-local-Chromium',caseName,
    status:response.status(),
    requestOriginMatchesApp:requestHeaders.origin===new URL(corporateAppUrl).origin,
    secFetchSite:requestHeaders['sec-fetch-site']||'ABSENT',
    hasOrigin:!!requestHeaders.origin,
    contentType:(responseHeaders['content-type']||'ABSENT').split(';')[0],
    // No UUID, email, secrets, cookies, token, full body or request URL logged.
   };
   console.log('QA421_CORPORATE_POST_DIAG '+JSON.stringify(diagnostics));
   if(response.status()!==201){
    // A denied HTTP response sometimes has an aborted streaming body.
    // Never let a pending Playwright body reader hang the full test job.
    const result=await Promise.race([
     response.text().then(text=>{
      try{return JSON.parse(text)?.error||'NON_ERROR_JSON'}
      catch{return text? 'NON_JSON_BODY':'EMPTY_BODY'}
     }).catch(()=> 'BODY_UNAVAILABLE'),
     new Promise(resolve=>setTimeout(()=>resolve('BODY_READ_TIMEOUT_2S'),2000))
    ]);
    console.log('QA421_CORPORATE_POST_ERROR '+JSON.stringify({source:'disposable-local-Chromium',error:result}));
    // Read the route's actual error from the disposable Node harness, using
    // the exact synthetic study body. Browser response streams can hang even
    // when headers have already arrived; this bounded replay distinguishes
    // INVALID_ORIGIN from membership/entitlement without application changes.
    try{
     const replay=await fetch(req.url(),{
      method:'POST',
      headers:{
       'content-type':'application/json',
       Origin:new URL(corporateAppUrl).origin,
       'Sec-Fetch-Site':'same-origin',
       Cookie:cookies.map(c=>c.name+'='+c.value).join('; ')
      },
      body:req.postData()||'',
      signal:AbortSignal.timeout(6000)
     });
     const replayData=await replay.json().catch(()=>({error:'NON_JSON_RESPONSE'}));
     console.log('QA421_CORPORATE_NODE_REPLAY '+JSON.stringify({
      source:'disposable-local-Node',status:replay.status,
      error:typeof replayData?.error==='string'?replayData.error:'NONE'
     }));
    }catch(e){
     console.log('QA421_CORPORATE_NODE_REPLAY '+JSON.stringify({
      source:'disposable-local-Node',error:e?.name==='TimeoutError'?'TIMEOUT_6S':'REPLAY_UNAVAILABLE'
     }));
    }
   }
   assert.equal(response.status(),201,'Authorized company study POST must return 201; see QA421_CORPORATE_POST_DIAG');
   const {id}=await response.json();
   await page.getByRole('heading',{name:'QA421 Corporate create regression',exact:true}).waitFor();
   await page.getByRole('button',{name:'Investment',exact:true}).click();
   await page.getByLabel('Construction and buildings',{exact:true}).fill('97531');
   const patchReceived=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/feasibility/organization-projects'&&
    new URL(r.url()).searchParams.get('organization')===org&&r.request().method()==='PATCH');
   await page.getByRole('button',{name:'Save company study',exact:true}).click();
   const patch=await patchReceived;
   assert.equal(patch.status(),200);
   assert.equal((await patch.json()).revision,2);
   const reloaded=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/feasibility/organization-projects'&&
    new URL(r.url()).searchParams.get('organization')===org&&r.request().method()==='GET');
   await page.reload();
   const reload=await reloaded;
   assert.equal(reload.status(),200);
   const {studies}=await reload.json();
   assert.equal(studies.find(row=>row.id===id)?.study.water.capex.buildings,97531);
   await page.getByRole('button',{name:'Investment',exact:true}).click();
   assert.equal(await page.getByLabel('Construction and buildings',{exact:true}).inputValue(),'97531');
   const forbidden=await fetch(url+'/rest/v1/feasibility_projects?id=eq.'+id+'&select=id',{
    headers:headers(outsider)
   });
   assert.equal(forbidden.status,200);
   assert.deepEqual(await forbidden.json(),[]);
   phase(caseName,'authorized-corporate-create-save-reload-and-outsider-deny-passed');
  }finally{await context.close().catch(()=>{});}
 });
 await check('Feasibility: managed copy on mobile preserves the personal source and isolates organizations',async()=>{
  const caseName='organization-copy';
  const target=await newOrg(marker+' Copy destination');
  enableCompanyFeasibility(target);
  const other=await newOrg(marker+' Copy isolation');
  const localApp='http://localhost:3000';
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  await context.addCookies(cookies.map(c=>({name:c.name,value:c.value,url:localApp})));
  const page=await context.newPage();
  page.setDefaultTimeout(12000);
  page.setDefaultNavigationTimeout(20000);
  const appPage=(scope,organization,locale='en')=>
   localApp+'/'+locale+'/feasibility?scope='+scope+'&organization='+organization+'&level=COMPANY';
  const studyTitle='QA Personal water copy source';
  const readPersonal=async()=>{
   const response=await page.request.get(localApp+'/api/feasibility/projects',{timeout:12000});
   assert.equal(response.status(),200);
   return response.json();
  };
  const readCompany=async(organization)=>{
   const response=await page.request.get(localApp+'/api/feasibility/organization-projects?organization='+organization,{timeout:12000});
   assert.equal(response.status(),200);
   return (await response.json()).studies;
  };
  const caseGuard=setTimeout(()=>{
   phase(caseName,'case-timeout-90s');
   void context.close().catch(()=>{});
  },90000);
  caseGuard.unref();
  try{
   phase(caseName,'personal-mobile-navigation');
   await page.goto(appPage('PERSONAL',target,'ar'));
   await page.getByRole('button',{name:'إضافة دراسة',exact:true}).click();
   await page.getByRole('textbox',{name:'اسم المشروع الجديد',exact:true}).fill(studyTitle);
   await page.getByRole('radio',{name:'مصنع مياه معبأة',exact:true}).check();
   await page.getByRole('button',{name:'إضافة مشروع +',exact:true}).click();
   const mobileMenu=page.getByRole('button',{name:'القائمة الجانبية',exact:true});
   await mobileMenu.tap();
   const sidebar=page.getByRole('dialog',{name:'القائمة الرئيسية',exact:true});
   const sectionToggle=sidebar.getByRole('button',{name:'دراسات الجدوى وتأسيس المشاريع',exact:true});
   await sectionToggle.tap();
   await sidebar.getByRole('group',{name:'أقسام دراسات الجدوى',exact:true})
    .getByRole('button',{name:'التقرير والتصدير',exact:true}).tap();
   await sidebar.waitFor({state:'hidden'});
   await page.getByRole('heading',{name:'التقرير الشامل',exact:true}).waitFor();
   assert.equal(await mobileMenu.getAttribute('aria-expanded'),'false');
   await page.screenshot({path:new URL('./screenshots/qa438-water-report-ar-mobile.png',import.meta.url).pathname,fullPage:true});
   for(const [locale,operations,hoursLabel,periodLabel] of [
    ['ar','الإنتاج والمبيعات','ساعات العمل اليومية','فترة التحصيل (يوم)'],
    ['en','Operations','Operating hours per day','Collection period (days)']
   ]){
    await page.goto(appPage('PERSONAL',target,locale));
    await page.getByRole('button',{name:operations,exact:true}).click();
    const cards=page.locator('.fs-royal-water-production-inputs');
    const layout=await cards.evaluate(element=>{
     const panels=[...element.children];
     return {
      cardsAreStacked:panels[0].getBoundingClientRect().bottom<=panels[1].getBoundingClientRect().top,
      fieldColumns:panels.map(panel=>getComputedStyle(panel.querySelector('.fs-form-grid')).gridTemplateColumns.split(/\s+/).length),
      fits:document.documentElement.scrollWidth===window.innerWidth
     };
    });
    assert.deepEqual(layout,{cardsAreStacked:true,fieldColumns:[2,2],fits:true});
    const hours=cards.getByLabel(hoursLabel,{exact:true});
    const collection=cards.getByLabel(periodLabel,{exact:true});
    if(locale==='ar'){
     await hours.fill('8');
     await collection.fill('45');
     await cards.getByLabel('المرتجعات %',{exact:true}).fill('2');
     await cards.getByLabel('قناة التوزيع',{exact:true}).selectOption('distributors');
     await cards.getByLabel('استغلال الخط في السنة الأولى %',{exact:true}).fill('70');
     for(const [label,value] of [
      ['عبوات في الساعة','4000'],['أيام العمل في الشهر','26'],
      ['عبوات في الكرتون','12'],['لترات في العبوة','0.5'],['فاقد المياه %','20']
     ]){
      await cards.getByLabel(label,{exact:true}).fill(value);
     }
     await page.getByRole('button',{name:'تفاصيل مصنع المياه',exact:true}).click();
     await page.getByLabel('فاقد العبوات النهائية %',{exact:true}).fill('20');
     await page.getByRole('button',{name:'عودة إلى القسم',exact:true}).click();
    }
    assert.equal(await hours.inputValue(),'8');
    assert.equal(await collection.inputValue(),'45');
    assert.equal(await cards.getByLabel(locale==='ar'?'المرتجعات %':'Returns %',{exact:true}).inputValue(),'2');
    assert.equal(await cards.getByLabel(locale==='ar'?'قناة التوزيع':'Distribution channel',{exact:true}).inputValue(),'distributors');
    const mix=page.locator('.fs-royal-water-production-balance .fs-royal-bar strong');
    assert.deepEqual(await mix.allTextContents(),[100,80,70,10].map(value=>new Intl.NumberFormat(locale).format(value)+' %'));
    assert.equal(await page.locator('.fs-royal-water-production-kpis .fs-metric > svg').count(),4);
    const forecast=page.locator('.fs-royal-water-forecasts');
    const forecastSummary=forecast.locator('summary');
    assert.equal(await forecast.getAttribute('open'),null);
    await forecastSummary.press('Enter');
    const annualSales=page.getByRole('region',{
     name:locale==='ar'?'جدول الاستغلال والمبيعات السنوية':'Annual utilization and sales table',exact:true,
    });
    assert.equal(await annualSales.getAttribute('tabindex'),'0');
    assert.equal(await annualSales.evaluate(element=>
     element.scrollWidth>element.clientWidth&&document.documentElement.scrollWidth===window.innerWidth),true);
    await forecastSummary.press('Enter');
    assert.equal(await annualSales.isVisible(),false);
    for(const [ar,en,value] of [
     ['الطاقة الاسمية عبوة/شهر','Nominal monthly bottles',832000],
     ['العبوات القابلة للبيع شهريًا','Monthly saleable bottles',665600],
     ['الكراتين الكاملة القابلة للبيع شهريًا','Monthly complete saleable cartons',55466],
     ['احتياج مياه المصدر م³/شهر','Source water demand m³/month',520]
    ]){
     const label=page.getByText(locale==='ar'?ar:en,{exact:true});
     const metric=page.locator('.fs-metric').filter({has:label});
     assert.equal(await metric.locator('strong').textContent(),new Intl.NumberFormat(locale).format(value));
    }
    await page.screenshot({path:new URL('./screenshots/qa438-water-operations-'+locale+'-mobile.png',import.meta.url).pathname,fullPage:true});
    const desktop=await browser.newContext({viewport:{width:1440,height:950},storageState:await context.storageState()});
    try{
     const desktopPage=await desktop.newPage();
     desktopPage.setDefaultTimeout(12000);
     await desktopPage.goto(appPage('PERSONAL',target,locale));
     await desktopPage.locator('.fs-tabs').getByRole('button',{name:operations,exact:true}).click();
     const desktopCards=desktopPage.locator('.fs-royal-water-production-inputs');
     assert.equal(await desktopCards.evaluate(element=>{
      const [capacity,sales]=[...element.children].map(panel=>panel.getBoundingClientRect());
      return Math.abs(capacity.top-sales.top)<2&&document.documentElement.scrollWidth===window.innerWidth;
     }),true);
     await desktopPage.screenshot({path:new URL('./screenshots/qa438-water-operations-'+locale+'-desktop.png',import.meta.url).pathname,fullPage:true});
    }finally{
     await desktop.close();
    }
   }
   await page.goto(appPage('PERSONAL',target,'ar'));
   const personalSaved=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/feasibility/projects'&&
    r.request().method()==='POST');
   await page.getByRole('button',{name:'حفظ سحابي',exact:true}).click();
   const personalResponse=await personalSaved;
   assert.equal(personalResponse.status(),201);
   await page.getByText(/حُفظت مسودة المشروع في السحابة/).waitFor();
   const source=(await readPersonal()).find(row=>row.study.title===studyTitle);
   assert.ok(source,'The personal source must exist in persistent storage');
   assert.equal(source.study.water.ops.hoursDay,8);
   assert.equal(source.study.water.operationsPlan.collectionDays,45);
   assert.equal(source.study.water.operationsPlan.finishedBottleLossPct,20);
   assert.equal(source.study.water.operationsPlan.returnsPct,2);
   assert.equal(source.study.water.operationsPlan.distributionChannel,'distributors');
   phase(caseName,'personal-saved');
   await page.getByRole('button',{name:'نسخ إلى مؤسسة',exact:true}).click();
   const dialog=page.getByRole('dialog');
   await dialog.getByText(marker+' Copy destination',{exact:true}).waitFor();
   const confirm=dialog.getByRole('button',{name:'نسخ إلى مؤسسة',exact:true});
   assert.equal(await confirm.isDisabled(),true);
   await dialog.getByText('أوافق على نسخ محتوى الدراسة إلى المؤسسة المحددة.',{exact:true}).tap();
   assert.equal(await dialog.getByRole('checkbox').isChecked(),true);
   phase(caseName,'consent-confirmed');
   const copySaved=page.waitForResponse(r=>new URL(r.url()).searchParams.get('action')==='copy'&&
    r.request().method()==='POST');
   await confirm.click();
   const copyResponse=await copySaved;
   assert.equal(copyResponse.status(),201);
   // The dialog uses the successful status only. Verify the copy through a
   // bounded authenticated read instead of waiting on Chromium's unused POST body.
   await dialog.getByText('أُضيفت النسخة إلى محفظة المؤسسة.',{exact:true}).waitFor();
   const copies=(await readCompany(target)).filter(row=>row.title===studyTitle);
   assert.equal(copies.length,1);
   const [copy]=copies;
   assert.notEqual(copy.id,source.id);
   assert.equal(copy.owner_user_id,null);
   assert.equal(copy.organization_id,target);
   phase(caseName,'organization-copy-created');

   for(const [selected,expected] of [[target,true],[other,false],[target,true]]){
    const portfolio=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/feasibility/organization-projects'&&
     new URL(r.url()).searchParams.get('organization')===selected&&r.request().method()==='GET');
    if(new URL(page.url()).searchParams.get('scope')==='PERSONAL'){
     await page.goto(appPage('ORGANIZATION',selected));
    }else{
     await page.getByRole('button',{name:'Choose organization from the main banner'}).click();
     const picker=page.getByRole('dialog',{name:'Choose organization from the main banner'});
     await picker.getByRole('radio',{name:selected===target?/Copy destination/:/Copy isolation/}).check();
     await picker.getByRole('button',{name:'Select organization',exact:true}).click();
    }
    const loaded=await portfolio;
    assert.equal(loaded.status(),200);
    if(expected){
     await page.getByRole('button',{name:/QA Personal water copy source/}).waitFor();
    }else{
     await page.getByRole('heading',{name:'No studies for the selected organization',exact:true}).waitFor();
    }
    const studies=await readCompany(selected);
    assert.equal(studies.some(row=>row.id===copy.id&&row.owner_user_id===null&&row.organization_id===target),expected);
    assert.equal(studies.some(row=>row.id===source.id),false);
   }
   phase(caseName,'two-organization-portfolios-verified');
   const owned=await readPersonal();
   assert.equal(owned.find(row=>row.id===source.id)?.revision,source.revision);
   assert.equal(owned.some(row=>row.id===copy.id),false);
   const outside=await fetch(url+'/rest/v1/feasibility_projects?id=eq.'+copy.id+'&select=id',{headers:headers(outsider),signal:AbortSignal.timeout(12000)});
   assert.equal(outside.status,200);
   assert.deepEqual(await outside.json(),[]);
  }finally{clearTimeout(caseGuard);await context.close().catch(()=>{});}
 });
 await check('Feasibility: restoring cloud studies preserves a local-only draft after reload',async()=>{
  // A fresh browser context has no cache from the earlier personal save.
  const organization=await newOrg(marker+' Restore scope');
  const context=await browser.newContext();
  await context.addCookies(cookies.map(c=>({name:c.name,value:c.value,url:appUrl})));
  const page=await context.newPage();
  page.setDefaultTimeout(12000);
  try{
   await page.goto(appUrl+'/en/feasibility?scope=PERSONAL&organization='+organization+'&level=COMPANY');
   await page.getByRole('button',{name:'New study',exact:true}).click();
   await page.getByRole('textbox',{name:'New project name',exact:true}).fill('QA local-only restore control');
   await page.getByRole('button',{name:'Add project +',exact:true}).click();
   await page.getByRole('button',{name:'Overview',exact:true}).click();
   const local=page.getByRole('button',{name:/QA local-only restore control/});
   const restored=page.getByRole('button',{name:/QA Personal water copy source/});
   await local.waitFor();
   assert.equal(await restored.count(),0);
   await page.getByRole('button',{name:'Restore from cloud',exact:true}).click();
   const personalNotice=page.getByText(/Added [1-9]\d* cloud drafts\. All local drafts were kept/);
   await personalNotice.waitFor();
   await restored.waitFor();
   const switcher=page.getByRole('group',{name:'Workspace scope'});
   await switcher.getByRole('button',{name:'Business',exact:true}).click();
   await page.waitForFunction(()=>new URLSearchParams(location.search).get('scope')==='ORGANIZATION');
   await page.getByRole('heading',{name:'No studies for the selected organization',exact:true}).waitFor();
   assert.equal(await personalNotice.count(),0,'Personal restore feedback must not appear in a company portfolio');
   await switcher.getByRole('button',{name:'Personal',exact:true}).click();
   await personalNotice.waitFor();
   await page.reload();
   await Promise.all([local.waitFor(),restored.waitFor()]);
   assert.equal(await local.getAttribute('aria-pressed'),'true');
  }finally{await context.close();}
 });
 await check('Royal overview: actual readiness, context and responsive AR/EN captures',async()=>{
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  await context.addCookies(cookies.map(c=>({name:c.name,value:c.value,url:appUrl})));
  const page=await context.newPage();
  page.setDefaultTimeout(12000);
  try{
   await page.goto(appUrl+'/en/feasibility?scope=PERSONAL');
   await page.getByRole('button',{name:'New study',exact:true}).click();
   await page.getByRole('textbox',{name:'New project name',exact:true}).fill('Royal synthetic overview');
   await page.getByRole('button',{name:'Add project +',exact:true}).click();
   for(const locale of ['ar','en']){
    for(const width of [1440,390]){
     await page.setViewportSize({width,height:1000});
     await page.goto(appUrl+'/'+locale+'/feasibility?scope=PERSONAL');
     await page.getByRole('heading',{name:'Royal synthetic overview',exact:true}).waitFor();
     const progress=page.locator('.fs-royal-portfolio-progress');
     assert.deepEqual(await progress.evaluate(el=>({value:el.value,max:el.max})),{value:2,max:6},
      'An empty draft passes only balanced zero funding and absence of a recorded legal blocker');
     const label=locale==='ar'?'سياق الدراسة':'Study context';
     const badges=page.getByLabel(label,{exact:true});
     assert.ok((await badges.innerText()).includes(new Intl.NumberFormat(locale,{style:'percent',maximumFractionDigits:0}).format(2/6)));
     assert.equal(await badges.locator('time').getAttribute('datetime')!==null,true);
     assert.equal(await page.locator('body').evaluate(el=>el.scrollWidth<=window.innerWidth),true);
     assert.equal(await page.locator('.fs-royal-priority-table thead th:visible').count(),width===390?2:4);
     assert.equal(await page.locator('.fs-royal-overview-kpis .fs-metric').evaluateAll(metrics=>metrics.every(metric=>{
      const icon=metric.querySelector('svg').getBoundingClientRect();
      const title=metric.querySelector('small').getBoundingClientRect();
      const style=getComputedStyle(metric.querySelector('small'));
      const textLeft=title.left+parseFloat(style.paddingLeft),textRight=title.right-parseFloat(style.paddingRight);
      return icon.right<=textLeft||icon.left>=textRight;
     })),true,'KPI labels must reserve space for icons in both directions');
     await page.screenshot({path:new URL('./screenshots/royal-overview-'+locale+'-'+width+'.png',import.meta.url).pathname,fullPage:true});
     await page.reload();
     await page.getByRole('heading',{name:'Royal synthetic overview',exact:true}).waitFor();
     assert.equal(await progress.evaluate(el=>el.value),2);
    }
   }
  }finally{await context.close();}
 });
 await check('Royal profile and investment: explicit supplier import, cloud persistence and responsive captures',async()=>{
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  await context.addCookies(cookies.map(c=>({name:c.name,value:c.value,url:appUrl})));
  const page=await context.newPage();page.setDefaultTimeout(12000);
  const title='Royal synthetic profile and CAPEX';
  try{
   await page.goto(appUrl+'/en/feasibility?scope=PERSONAL');
   await page.getByRole('button',{name:'New study',exact:true}).click();
   await page.getByRole('textbox',{name:'New project name',exact:true}).fill(title);
   await page.getByRole('radio',{name:'Bottled-water factory',exact:true}).check();
   await page.getByRole('button',{name:'Add project +',exact:true}).click();
   await page.getByRole('button',{name:'Profile',exact:true}).click();
   await page.getByLabel('Country',{exact:true}).fill('Synthetic country');
   await page.getByRole('combobox',{name:'Study currency',exact:true}).selectOption('USD');
   await page.getByLabel('Detailed project location',{exact:true}).fill('Synthetic site');
   await page.getByLabel('Legal owner as documented',{exact:true}).fill('Synthetic documented owner');
   await page.getByRole('button',{name:'Supplier quotes',exact:true}).click();
   await page.getByRole('button',{name:'Add offer',exact:true}).click();
   await page.locator('.fs-register-row summary').click();
   await page.getByLabel('Vendor',{exact:true}).fill('Synthetic QA vendor');
   await page.getByLabel('Item',{exact:true}).fill('Synthetic equipment');
   await page.getByLabel('Quote value',{exact:true}).fill('5000');
   await page.getByRole('button',{name:'Investment',exact:true}).click();
   await page.getByRole('button',{name:'Import supplier quote',exact:true}).click();
   const dialog=page.getByRole('dialog');
   await dialog.getByRole('combobox',{name:'Supplier quote',exact:true}).selectOption({index:1});
   await dialog.getByRole('combobox',{name:'Target investment item',exact:true}).selectOption('line');
   const apply=dialog.getByRole('button',{name:'Apply quote to item',exact:true});
   assert.equal(await apply.isDisabled(),true);
   await dialog.getByRole('checkbox').check();await apply.click();
   assert.equal(await page.getByLabel('Bottling and packaging line',{exact:true}).inputValue(),'5000');
   await page.getByText(/Quote source: Synthetic QA vendor/).waitFor();
   const saved=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/feasibility/projects'&&r.request().method()==='POST');
   await page.getByRole('button',{name:'Save to cloud',exact:true}).click();assert.equal((await saved).status(),201);
   const response=await page.request.get(appUrl+'/api/feasibility/projects');assert.equal(response.status(),200);
   const row=(await response.json()).find(x=>x.title===title);assert.ok(row);
   assert.equal(row.study.legalOwner,'Synthetic documented owner');assert.equal(row.study.siteDescription,'Synthetic site');
   assert.equal(row.study.water.capex.line,5000);assert.equal(row.study.water.capexQuoteSources.line.amount,5000);
   assert.equal(row.study.water.capexQuoteSources.line.currency,'USD');
   for(const locale of ['ar','en'])for(const width of [1440,390]){
    await page.setViewportSize({width,height:1000});await page.goto(appUrl+'/'+locale+'/feasibility?scope=PERSONAL');
    const ar=locale==='ar';await page.getByRole('heading',{name:title,exact:true}).waitFor();
    await page.getByRole('button',{name:ar?'بيانات المشروع':'Profile',exact:true}).click();
    assert.equal(await page.getByLabel(ar?'المالك القانوني وفق المستندات':'Legal owner as documented',{exact:true}).inputValue(),'Synthetic documented owner');
    assert.equal(await page.getByLabel(ar?'موقع المشروع التفصيلي':'Detailed project location',{exact:true}).inputValue(),'Synthetic site');
    assert.equal(await page.locator('body').evaluate(el=>el.scrollWidth<=window.innerWidth),true);
    await page.screenshot({path:new URL('./screenshots/royal-profile-'+locale+'-'+width+'.png',import.meta.url).pathname,fullPage:true});
    await page.getByRole('button',{name:ar?'تكاليف الاستثمار':'Investment',exact:true}).click();
    assert.equal(await page.getByLabel(ar?'خط التعبئة والتغليف':'Bottling and packaging line',{exact:true}).inputValue(),'5000');
    assert.equal(await page.locator('body').evaluate(el=>el.scrollWidth<=window.innerWidth),true);
    await page.screenshot({path:new URL('./screenshots/royal-investment-'+locale+'-'+width+'.png',import.meta.url).pathname,fullPage:true});
    await page.getByRole('button',{name:ar?'استيراد عرض مورد':'Import supplier quote',exact:true}).click();
    await page.screenshot({path:new URL('./screenshots/royal-quote-import-'+locale+'-'+width+'.png',import.meta.url).pathname,fullPage:true});
    await page.getByRole('dialog').getByRole('button',{name:ar?'إلغاء':'Cancel',exact:true}).click();
   }
   await page.getByRole('button',{name:'Report and export',exact:true}).click();
   await page.getByText('Synthetic documented owner',{exact:true}).waitFor();
   await page.getByText(/Synthetic site/).waitFor();
  }finally{await context.close();}
 });
 await check('issue 421: unrelated user cannot read Billing details in either organization',async()=>{
  const r=await fetch(url+'/rest/v1/organizations?select=id,contact_email,registered_address',{
   headers:headers(outsider)
  });
  assert.equal(r.status,200);
  const rows=await r.json();
  assert.ok(Array.isArray(rows));
  for(const x of rows){
   assert.notEqual(x.contact_email,synthetic.direct.email);
   assert.notEqual(x.contact_email,synthetic.visited.email);
  }
 });
 assert.equal(observations.length,2);
 assert.ok(observations.every(o=>o.post===200&&o.get===200&&o.emailPersisted&&o.addressPersisted));
 console.log('QA421_AB_RESULT '+JSON.stringify({source:'disposable-local-Auth/PostgREST/Chromium',
  head:process.env.GITHUB_SHA||'LOCAL',results:observations}));
 return observations;
}
