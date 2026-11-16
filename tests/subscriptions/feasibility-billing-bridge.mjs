// Issue #421 only. Runs in the disposable local Supabase + Chromium fixture.
// No real QA/Production user or billing value is modified.
import assert from 'node:assert/strict';

const marker='QA421';
const phase=(caseName,step)=>console.log('QA421_PHASE '+JSON.stringify({source:'disposable-local-Chromium',caseName,step}));
const synthetic={
 direct:{email:'billing-direct@qa.example.test',address:'QA test address — direct billing'},
 visited:{email:'billing-after-feasibility@qa.example.test',address:'QA test address — after feasibility'},
};

export async function runFeasibilityBillingAB({browser,cookies,appUrl,url,owner,outsider,headers,check}){
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
    // Open a personal QA study inside this disposable Chromium context;
    // opening the Feasibility module and switching scopes are the billing
    // integration variable. Company-study *creation* is tested separately
    // because an unexplained POST 403 must not suppress Billing A/B evidence.
    await page.getByRole('textbox',{name:'New project name',exact:true}).fill('QA421 Personal draft');
    await page.getByRole('button',{name:'Add project +',exact:true}).click();
    await page.getByRole('button',{name:/QA421 Personal draft/}).first().waitFor();
    phase(caseName,'personal-study-opened');
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
    await page.getByRole('button',{name:'Add project +',exact:true}).waitFor({state:'visible'});
    assert.equal(await page.getByRole('button',{name:/QA421 Personal draft/}).count(),0,
     'Personal study must not appear in organization portfolio');
    phase(caseName,'topbar-switch-back-to-personal');
    await switcher.getByRole('button',{name:'Personal',exact:true}).click();
    await page.waitForFunction(()=>new URLSearchParams(location.search).get('scope')==='PERSONAL');
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
  const context=await browser.newContext();
  await context.addCookies(cookies.map(c=>({name:c.name,value:c.value,url:appUrl})));
  const page=await context.newPage();
  page.setDefaultTimeout(12000);
  page.setDefaultNavigationTimeout(20000);
  try{
   phase(caseName,'organization-navigation');
   const got=page.waitForResponse(r=>{
    const u=new URL(r.url());
    return u.pathname==='/api/feasibility/organization-projects'&&
     u.searchParams.get('organization')===org&&r.request().method()==='GET';
   });
   await page.goto(appUrl+'/en/feasibility?scope=ORGANIZATION&organization='+org+'&level=COMPANY');
   const get=await got;
   assert.equal(get.status(),200,'Owner company read must be granted before create');
   const grants=await get.json();
   assert.equal(grants.canWrite,true,'Owner company create entitlement must be active');
   phase(caseName,'owner-read-and-write-entitlement-verified');
   const name=page.getByRole('textbox',{name:'New project name',exact:true});
   await name.fill('QA421 Corporate create regression');
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
    requestOriginMatchesApp:requestHeaders.origin===new URL(appUrl).origin,
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
   }
   assert.equal(response.status(),201,'Authorized company study POST must return 201; see QA421_CORPORATE_POST_DIAG');
   phase(caseName,'authorized-corporate-create-passed');
  }finally{await context.close().catch(()=>{});}
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
