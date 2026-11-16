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
    phase(caseName,'topbar-switch-to-organization');
    phase(caseName,'topbar-return-to-organization');
    await switcher.getByRole('button',{name:'Business',exact:true}).click();
    await page.waitForFunction(()=>new URLSearchParams(location.search).get('scope')==='ORGANIZATION');
    phase(caseName,'topbar-organization-selected');
    const companyForm=page.getByRole('button',{name:'Add project +',exact:true});
    await companyForm.waitFor({state:'visible'});
    await page.waitForFunction(()=>{
     const btn=[...document.querySelectorAll('button')].find(b=>b.textContent?.trim()==='Add project +');
     return !!btn&&!btn.disabled;
    },null,{timeout:12000});
    phase(caseName,'organization-authorized-form-ready');
    await page.getByRole('textbox',{name:'New project name',exact:true}).fill('QA421 Test factory');
    const posted=page.waitForResponse(r=>r.url().includes('/api/feasibility/organization-projects?')&&r.request().method()==='POST');
    phase(caseName,'organization-create-post-start');
    await companyForm.click();
    const postResponse=await posted;
    phase(caseName,'organization-create-post-response-'+postResponse.status());
    if(postResponse.status()!==201){
     const rejected=await postResponse.json().catch(()=>({error:'NON_JSON_RESPONSE'}));
     console.log('QA421_FEASIBILITY_POST_DENIED '+JSON.stringify({
      source:'disposable-local-Chromium',status:postResponse.status(),
      error:typeof rejected?.error==='string'?rejected.error:'UNKNOWN',
      // No credential, organization UUID, contact email or study content is logged.
      caseName
     }));
    }
    assert.equal(postResponse.status(),201,'Company Feasibility POST must create an owned test study');
    await page.getByRole('heading',{name:'QA421 Test factory',exact:true}).first().waitFor();
    phase(caseName,'organization-study-opened');
    phase(caseName,'topbar-switch-back-to-personal');
    await switcher.getByRole('button',{name:'Personal',exact:true}).click();
    await page.waitForFunction(()=>new URLSearchParams(location.search).get('scope')==='PERSONAL');
    await page.getByRole('heading',{name:'Feasibility & project development',exact:true}).waitFor();
    await switcher.getByRole('button',{name:'Business',exact:true}).click();
    await page.waitForFunction(()=>new URLSearchParams(location.search).get('scope')==='ORGANIZATION');
    await page.getByRole('button',{name:/QA421 Test factory/}).first().waitFor();
    assert.equal(new URL(page.url()).searchParams.get('organization'),org);
    phase(caseName,'organization-study-reopened');
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
