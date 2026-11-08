// LOCAL UI fixture only. Not authentication, RLS or accounting certification.
import {createServer} from 'node:http';
import {createHmac} from 'node:crypto';
import {createServerClient} from '@supabase/ssr';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.SETTINGS_BROWSER_MODULE);
const locales=(process.env.SETTINGS_UI_LOCALES??'ar,en').split(',');
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
const entities=[{id:'entity-1',organization_id:orgId,name:'كيان الرياض',entity_type:'COMPANY',base_currency:'SAR',registration_no:'1010000001',active:true}];
let readinessGate=null,releaseReadiness;
const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('**/api/**',async route=>{
 const req=route.request(),u=new URL(req.url());let data={};const body=req.postDataJSON?.();
 if(u.pathname==='/api/organizations'){if(req.method()==='PATCH'){Object.assign(body.id===orgId?org:other,body);data=body.id===orgId?org:other;}else data=[org,other];}
 else if(u.pathname==='/api/organizations/entities'){if(req.method()==='POST')entities.push({...body,id:'entity-created',active:true});else if(req.method()==='PATCH')Object.assign(entities.find(e=>e.id===body.id),body);data=req.method()==='GET'?entities.filter(e=>e.organization_id===u.searchParams.get('organization_id')):entities.at(-1);}
 else if(u.pathname==='/api/organizations/users')data={actor_role:'OWNER',actor_user_id:user.id,users:[{user_id:user.id,email:user.email,name:'مالك الاختبار',role:'OWNER',status:'ACTIVE'}],invitations:[]};
 else if(u.pathname==='/api/organizations/roles')data={roles:[]};
 else if(u.pathname==='/api/organizations/permissions')data={roles:[],overrides:[],approval_policy:'OWNER_CONTROLLED'};
 else if(u.pathname==='/api/financial-reporting/fiscal')data={organizationId:orgId,calendar:{start_month:1,start_day:1,version:1,retained_earnings_account:'3300'},period:{start:'2026-01-01',end:'2026-12-31'},closures:[],canConfigure:true,canClose:false,references:[],retainedCandidates:[],asOf:'2026-11-08'};
 else if(u.pathname==='/api/financial-reporting/chart')data={organizationId:orgId,accounts:[{kind:'ASSET',isActive:true,isPostable:true},{kind:'EQUITY',isActive:true,isPostable:true}]};
 else if(u.pathname==='/api/financial-register')data={organizationIds:[orgId],accounts:[{id:'bank-1',organizationId:orgId,name:'حساب المؤسسة',type:'BANK',currency:'SAR'}]};
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
 for(const locale of locales){
  const ar=locale==='ar';await page.goto(`${app}/${locale}/settings?organization=${orgId}`);
  await page.getByLabel(ar?'اسم المؤسسة':'Organization name',{exact:true}).waitFor();
  await page.getByLabel(ar?'البريد الرسمي':'Official email',{exact:true}).fill('updated@example.com');
  await page.getByRole('button',{name:ar?'حفظ التغييرات':'Save changes',exact:true}).click();
  await page.getByText(ar?'تم حفظ بيانات المؤسسة.':'Organization details saved.',{exact:true}).waitFor();
  await page.reload();await page.getByLabel(ar?'البريد الرسمي':'Official email',{exact:true}).waitFor();assert.equal(await page.getByLabel(ar?'البريد الرسمي':'Official email',{exact:true}).inputValue(),'updated@example.com');checks.push(locale+' native organization saved and reloaded');
  if(!process.env.SETTINGS_UI_SKIP_SNAPSHOTS)for(const [path,key] of [['settings','organization'],['settings/structure','structure'],['settings/regulatory','regulatory'],['settings/financial','financial'],['settings/financial/fiscal-years','fiscal-editor'],['settings/team','team'],['settings/system','system'],['billing','billing']]){
   await page.goto(`${app}/${locale}/${path}?organization=${orgId}`);
   const root=path==='billing'?page.locator('.yb-billing'):path==='settings/system'?page.locator('[data-system-preferences]'):path==='settings/regulatory'?page.locator('[data-regulatory-workspace]'):path==='settings/structure'?page.locator('[data-structure-workspace]'):path.startsWith('settings/financial')?page.locator('[data-financial-settings]'):path==='settings/team'?page.locator('.settings-native-team'):page.locator('.organization-details-workspace');await root.waitFor();
   if(path==='settings/financial')await page.locator('[data-financial-overview-ready=true]').waitFor();
   if(path==='settings/financial/fiscal-years')await page.getByLabel(ar?'شهر بداية السنة':'Fiscal start month',{exact:true}).waitFor();
   if(path==='settings/structure')await page.getByRole('button',{name:ar?'إضافة كيان':'Add entity',exact:true}).waitFor();
   if(path==='settings/team')await page.getByText(user.email,{exact:true}).first().waitFor();
   if(path!=='billing')assert.equal(await page.locator('.settings-secondary-links').count(),0,'No duplicate subscription links under the primary settings navigation');
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
   for(const width of (process.env.SETTINGS_UI_SKIP_SNAPSHOTS?[]:[1490,1280,768,390])){await page.setViewportSize({width,height:1050});await page.waitForTimeout(300);await page.evaluate(()=>window.scrollTo(0,0));const overlaps=await page.locator('.settings-workspace').evaluate(root=>{const items=[...root.querySelectorAll('button,a,input,select,textarea')].filter(el=>el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden').map(el=>({label:el.getAttribute('aria-label')||el.textContent?.trim().slice(0,40)||el.tagName,box:el.getBoundingClientRect()}));const found=[];for(let i=0;i<items.length;i++)for(let j=i+1;j<items.length;j++){const a=items[i],b=items[j];if(Math.min(a.box.right,b.box.right)-Math.max(a.box.left,b.box.left)>2&&Math.min(a.box.bottom,b.box.bottom)-Math.max(a.box.top,b.box.top)>2)found.push(a.label+' / '+b.label);}return found;});assert.deepEqual(overlaps,[],path+' '+locale+' '+width+' overlapping controls');const clippedTabs=await page.locator('.settings-tabs a>span,.settings-subsection-nav a>span').evaluateAll(items=>items.filter(el=>el.scrollWidth>el.clientWidth+1).map(el=>el.textContent));assert.deepEqual(clippedTabs,[],path+' '+locale+' '+width+' clipped tab labels');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${path} ${locale} ${width} overflow`);await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:`${out}/${key}-${locale}-${width}.png`,fullPage:true});}
   await page.setViewportSize({width:1490,height:1050});
   checks.push(locale+' '+path+' desktop/mobile no iframe/overflow');
  }
 }
 await page.goto(`${app}/en/settings?organization=${orgId}`);await page.getByLabel('Official email',{exact:true}).waitFor();org.registered_address='Concurrent legal fixture';await page.getByLabel('Official email',{exact:true}).fill('delta-profile@example.com');await page.getByRole('button',{name:'Save changes',exact:true}).click();await page.getByText('Organization details saved.',{exact:true}).waitFor();assert.equal(org.registered_address,'Concurrent legal fixture');
 await page.goto(`${app}/en/settings/regulatory?organization=${orgId}`);await page.getByLabel('Registered legal address',{exact:true}).waitFor();org.contact_phone='+966500999999';await page.getByLabel('Registered legal address',{exact:true}).fill('Updated legal fixture');await page.getByRole('button',{name:'Save changes',exact:true}).click();await page.getByText('Organization details saved.',{exact:true}).waitFor();assert.equal(org.contact_phone,'+966500999999');assert.equal(org.contact_email,'delta-profile@example.com');checks.push('Profile and legal saves preserve newer fields from the other section');
 await page.goto(`${app}/en/settings/structure?organization=${orgId}`);await page.getByRole('button',{name:'Add entity',exact:true}).click();await page.getByLabel('Entity name',{exact:true}).fill('Native fixture entity');await page.getByRole('button',{name:'Save entity',exact:true}).click();await page.getByText('Entity saved.',{exact:true}).waitFor();await page.reload();await page.getByRole('cell',{name:'Native fixture entity',exact:true}).waitFor();checks.push('Native entity created and reloaded in the selected organization');
 await page.goto(`${app}/en/settings/system?organization=${orgId}`);const toggle=page.getByRole('switch',{name:'System notifications'});await toggle.waitFor();await toggle.uncheck();await page.getByRole('button',{name:'Save changes',exact:true}).click();await page.getByText('Your preferences were saved.',{exact:true}).waitFor();await page.reload();await toggle.waitFor();assert.equal(await toggle.isChecked(),false);checks.push('System preferences persisted after reload');
 }
 await page.goto(`${app}/en/settings/regulatory?organization=${orgId}`);await page.getByRole('button',{name:'E-invoicing',exact:true}).click();await page.locator('.vat-panel').waitFor();assert.equal(await page.locator('.financial-setup-regulatory-editor .console-tabs').count(),0);await page.getByRole('button',{name:'Edit number',exact:true}).click();await page.getByRole('combobox',{name:'Registration status',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Tax registration',exact:true}).getAttribute('aria-pressed'),'true');checks.push('Invoice unit tax-number action opens the native accessible registration form');
 for(const locale of locales){
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
  for(const width of (process.env.SETTINGS_UI_SKIP_SNAPSHOTS?[]:[1490,1280,768,390])){
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
  for(const width of (process.env.SETTINGS_UI_SKIP_SNAPSHOTS?[]:[1490,1280,768,390])){
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
