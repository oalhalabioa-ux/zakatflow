// LOCAL UI fixture only. Not authentication, RLS or accounting certification.
import {createServer} from 'node:http';
import {createHmac} from 'node:crypto';
import {createServerClient} from '@supabase/ssr';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.SETTINGS_BROWSER_MODULE);
const app='http://127.0.0.1:3007',authUrl='http://127.0.0.1:55441';
const user={id:'1dcb439d-89a5-4d64-8a6f-b324eeebbe20',aud:'authenticated',role:'authenticated',email:'owner@example.com',created_at:'2026-01-01T00:00:00Z',app_metadata:{provider:'email'},user_metadata:{}};
const auth=createServer((req,res)=>{res.writeHead(200,{'Content-Type':'application/json','Access-Control-Allow-Origin':app,'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info,x-supabase-api-version','Access-Control-Allow-Methods':'GET,POST,OPTIONS'});res.end(req.method==='OPTIONS'?'':JSON.stringify(user));});await new Promise(r=>auth.listen(55441,'127.0.0.1',r));
const b64=v=>Buffer.from(JSON.stringify(v)).toString('base64url');const unsigned=b64({alg:'HS256',typ:'JWT'})+'.'+b64({sub:user.id,aud:'authenticated',role:'authenticated',exp:Math.floor(Date.now()/1000)+3600,iat:Math.floor(Date.now()/1000)});const token=unsigned+'.'+createHmac('sha256','local-fixture-only').update(unsigned).digest('base64url');
const cookies=[];const client=createServerClient(authUrl,'ui-fixture-key',{cookies:{getAll:()=>cookies,setAll:items=>items.forEach(v=>cookies.push(v))}});await client.auth.setSession({access_token:token,refresh_token:'local-fixture-only'});
const browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1490,height:1050}});await context.addCookies(cookies.map(c=>({name:c.name,value:c.value,url:app})));
const orgId='1fbe9d7b-efdd-47cb-b3f9-bc031f17b76d',otherId='41be9d7b-efdd-47cb-b3f9-bc031f17b76d';
const org={id:orgId,name:'شركة يقين التجارية',legal_name:'شركة يقين التجارية المحدودة',owner_user_id:user.id,entity_type:'COMPANY',base_currency:'SAR',organization_kind:'HOLDING',sort_order:1,country_code:'SA',commercial_registration_number:'1010000001',registered_address:'شارع الملك فهد',registered_city:'الرياض',registered_region:'الرياض',registered_postal_code:'11564',activity:'التجارة العامة',contact_email:'office@example.com',contact_phone:'+966500000000',registration_authority:'وزارة التجارة',registration_expires_on:'2028-12-31'};
const other={...org,id:otherId,name:'المؤسسة الثانية',legal_name:'المؤسسة الثانية',sort_order:2};
let prefs={profile:{name:'QA owner',phone:'',base_currency:'SAR',locale:'ar',timezone:'Asia/Riyadh',calendar_type:'GREGORIAN',nisab_standard:'SILVER'},settings:{allocation_method:'FIFO',notifications_enabled:true,assessment_reminders:true,theme:'yaqeen-business'}};
const subscription=id=>({organization_id:id,organization_name:id===orgId?org.name:other.name,status:'trialing',can_write:true,trial_started_at:'2026-11-01T00:00:00Z',trial_ends_at:'2026-12-01T00:00:00Z',days_remaining:23,trial_duration_days:30,active_users:id===orgId?3:1,max_users:5,server_now:'2026-11-08T12:00:00Z'});
let readinessGate=null,releaseReadiness;
const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('**/api/**',async route=>{
 const req=route.request(),u=new URL(req.url());let data={};const body=req.postDataJSON?.();
 if(u.pathname==='/api/organizations'){if(req.method()==='PATCH'){Object.assign(body.id===orgId?org:other,body);data=body.id===orgId?org:other;}else data=[org,other];}
 else if(u.pathname==='/api/organizations/entities')data=[{id:'branch',name:'فرع الرياض',entity_type:'BRANCH',active:true}];
 else if(u.pathname==='/api/subscriptions')data=subscription(u.searchParams.get('organization_id'));
 else if(u.pathname==='/api/subscriptions/requests')data={rows:[],can_request:true};
 else if(u.pathname==='/api/settings'){if(req.method()==='PUT'){prefs={profile:{...prefs.profile,...body.profile},settings:{...prefs.settings,...body.settings}};}data=prefs;}
 else if(u.pathname==='/api/currencies')data=[{code:'SAR'},{code:'USD'},{code:'EUR'}];
 else if(u.pathname==='/api/vat/settings')data={can_edit:true,profile:{registration_status:'NOT_REGISTERED',registered_name:org.name,filing_frequency:'QUARTERLY',period_start_month:1,seller_city:'الرياض',seller_street:'شارع الملك فهد'}};
 else if(u.pathname==='/api/vat')data={};
 else if(u.pathname.includes('/notifications'))data=[];
 else if(u.pathname.includes('/financial-reporting/setup-readiness')){if(readinessGate)await readinessGate;data={organizationId:orgId,mode:u.searchParams.get('mode'),statuses:{organization:'READY',chart:'IN_PROGRESS',fiscal:'READY',posting:'IN_PROGRESS',banking:'READY',opening:'IN_PROGRESS',users:'READY',regulatory:'NOT_STARTED',structure:'NOT_STARTED',review:'BLOCKED',finished:'BLOCKED'},ready:false,sourceChecked:false,certification:'NOT_CERTIFIED'};}
 else data=[];
 await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
});
const out=process.env.SETTINGS_UI_OUT??'/tmp/yaqeen-settings-ui';await mkdir(out,{recursive:true});const checks=[];
try{
 if(!process.env.SETTINGS_JOURNEY_ONLY){
 for(const locale of ['ar','en']){
  const ar=locale==='ar';await page.goto(`${app}/${locale}/settings?organization=${orgId}`);
  await page.getByLabel(ar?'اسم المؤسسة':'Organization name',{exact:true}).waitFor();
  await page.getByLabel(ar?'البريد الرسمي':'Official email',{exact:true}).fill('updated@example.com');
  await page.getByRole('button',{name:ar?'حفظ التغييرات':'Save changes',exact:true}).click();
  await page.getByText(ar?'تم حفظ بيانات المؤسسة.':'Organization details saved.',{exact:true}).waitFor();
  await page.reload();await page.getByLabel(ar?'البريد الرسمي':'Official email',{exact:true}).waitFor();assert.equal(await page.getByLabel(ar?'البريد الرسمي':'Official email',{exact:true}).inputValue(),'updated@example.com');checks.push(locale+' native organization saved and reloaded');
  for(const [path,key] of [['settings','organization'],['settings/regulatory','regulatory'],['settings/system','system'],['billing','billing']]){
   await page.goto(`${app}/${locale}/${path}?organization=${orgId}`);
   const root=path==='billing'?page.locator('.yb-billing'):path==='settings/system'?page.locator('[data-system-preferences]'):path==='settings/regulatory'?page.locator('[data-regulatory-workspace]'):page.locator('.organization-details-workspace');await root.waitFor();
   if(path==='settings/system')await page.getByRole('button',{name:ar?'حفظ التعديلات':'Save changes',exact:true}).waitFor();
   if(path==='billing'){
    await page.locator('.yb-details').getByText('شركة يقين التجارية',{exact:true}).waitFor();
    assert.equal(await page.locator('.settings-tabs').count(),0);
    const contrast=await page.locator('.yb-plan-card h2').evaluate(el=>{
     const rgb=s=>s.match(/[\d.]+/g).slice(0,3).map(Number).map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4;});
     const lum=s=>{const c=rgb(s);return .2126*c[0]+.7152*c[1]+.0722*c[2];};
     const a=lum(getComputedStyle(el).color),b=lum(getComputedStyle(el.closest('.yb-plan-card')).backgroundColor);
     return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
    });assert.ok(contrast>=4.5,'Plan heading must be readable on its actual surface');
   }
   assert.equal(await page.locator('iframe').count(),0);
   for(const width of [1490,390]){await page.setViewportSize({width,height:1050});await page.waitForTimeout(300);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${path} ${locale} ${width} overflow`);await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:`${out}/${key}-${locale}-${width}.png`,fullPage:true});}
   await page.setViewportSize({width:1490,height:1050});
   checks.push(locale+' '+path+' desktop/mobile no iframe/overflow');
  }
 }
 await page.goto(`${app}/en/settings/system?organization=${orgId}`);const toggle=page.getByRole('switch',{name:'System notifications'});await toggle.waitFor();await toggle.uncheck();await page.getByRole('button',{name:'Save changes',exact:true}).click();await page.getByText('Your preferences were saved.',{exact:true}).waitFor();await page.reload();await toggle.waitFor();assert.equal(await toggle.isChecked(),false);checks.push('System preferences persisted after reload');
 }
 for(const locale of ['ar','en']){
  const ar=locale==='ar';org.country_code='';
  await page.goto(`${app}/${locale}/settings?organization=${orgId}`);
  await page.evaluate(id=>localStorage.setItem('yaqeen:financial-setup:v1:'+id,JSON.stringify({mode:'EXISTING',industry:'GENERAL',completed:[],deferred:[],step:'review'})),orgId);
  readinessGate=new Promise(resolve=>{releaseReadiness=resolve;});
  await page.goto(`${app}/${locale}/settings/financial/setup?organization=${orgId}`);
  const progress=page.getByRole('progressbar');await progress.waitFor();
  assert.equal(await progress.getAttribute('aria-valuenow'),null,'Loading must not render a fabricated zero percent');
  releaseReadiness();readinessGate=null;
  await page.waitForFunction(()=>document.querySelector('[role=progressbar]')?.getAttribute('aria-valuenow')!==null);
  assert.equal(await page.locator('[data-setup-view=overview]').count(),1,'A saved editor step must not replace the overview');
  assert.equal(await page.locator('[data-setup-native-workspace]').count(),0,'Overview must not mount full editors');
  assert.equal(await page.locator('.financial-setup-stage-group').count(),5);
  for(const width of [1490,390]){
   await page.setViewportSize({width,height:1050});await page.waitForTimeout(200);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Journey '+locale+' '+width+' overflow');
   const cramped=await page.locator('.financial-setup-group-title strong').evaluateAll(items=>items.some(el=>el.getBoundingClientRect().height>parseFloat(getComputedStyle(el).lineHeight)*3+1));
   assert.equal(cramped,false,'Group titles must not collapse into narrow vertical labels');
   await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:`${out}/journey-overview-${locale}-${width}.png`,fullPage:true});
  }
  await page.setViewportSize({width:1490,height:1050});
  await page.getByRole('button',{name:ar?/متابعة الإعداد/:/Continue setup/}).click();
  await page.locator('[data-setup-view=editor]').waitFor();
  const editor=page.locator('[data-setup-native-workspace=organization]');await editor.getByLabel(ar?'اسم المؤسسة':'Organization name',{exact:true}).waitFor();
  await editor.getByLabel(ar?'الدولة':'Country',{exact:true}).selectOption('SA');
  await editor.getByRole('button',{name:ar?'حفظ التغييرات':'Save changes',exact:true}).click();
  await editor.getByText(ar?'تم حفظ بيانات المؤسسة.':'Organization details saved.',{exact:true}).waitFor();
  assert.equal(org.country_code,'SA','Native journey saves the same organization source');
  for(const width of [1490,390]){
   await page.setViewportSize({width,height:1050});await page.waitForTimeout(200);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Journey editor '+locale+' '+width+' overflow');
   await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:`${out}/journey-editor-${locale}-${width}.png`,fullPage:true});
  }
  await page.getByRole('button',{name:ar?'العودة إلى لوحة الإعداد':'Back to setup overview',exact:true}).click();
  await page.locator('[data-setup-view=overview]').waitFor();
  assert.equal(await page.locator('[data-setup-native-workspace]').count(),0);
  checks.push(locale+' journey overview, pending readiness, native save, editor return and responsive layout');
 }
 assert.deepEqual(errors,[]);console.log(JSON.stringify({kind:'LOCAL_UI_FIXTURE_ONLY',checks,screenshots:out,errors},null,2));await writeFile(out+'/result.json',JSON.stringify({kind:'LOCAL_UI_FIXTURE_ONLY',checks,errors},null,2));
}catch(error){await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:out+'/failure.png',fullPage:true}).catch(()=>{});await writeFile(out+'/failure-state.txt',await page.locator('body').innerText().catch(()=>''));throw error;}finally{releaseReadiness?.();await browser.close();await new Promise(r=>auth.close(r));}
