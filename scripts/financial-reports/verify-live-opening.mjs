// Full canonical schema, genuine Auth/PostgREST and actual Next/browser. Loopback only.
import {execFileSync,spawn} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile,mkdir,writeFile,open} from 'node:fs/promises';
import {createClient} from '@supabase/supabase-js';
import {createServerClient} from '@supabase/ssr';
import assert from 'node:assert/strict';
const dir=process.env.OPENING_QA_WORKDIR;
assert.ok(dir&&process.env.RUNNER_TEMP&&dir.startsWith(process.env.RUNNER_TEMP+'/'),'DISPOSABLE_RUNNER_REQUIRED');
const status=JSON.parse(execFileSync('npx',['--yes','supabase@2.122.0','status','--workdir',dir,'--output','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
assert.equal(status.API_URL,'http://127.0.0.1:54321');
const url=status.API_URL,app='http://localhost:3200',out='docs/financial-reports/evidence-opening-live';
const sql=input=>execFileSync('docker',['exec','-i','supabase_db_opening-workspace-qa','psql','-X','-q','-t','-A','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres'],{input,encoding:'utf8',timeout:60000,maxBuffer:8*1024*1024,stdio:['pipe','pipe','pipe']}).trim();
const checks=[],errors=[],report={engine:'Full canonical migrations + real Supabase Auth/PostgREST + Next + Chromium',remoteConnections:false,checks};
let server,browser,page;
const check=async(name,run)=>{console.log('CHECK '+name);let deadline;try{await Promise.race([run(),new Promise((_,reject)=>{deadline=setTimeout(()=>reject(Error('CHECK_TIMEOUT: '+name)),90000)})]);checks.push({name,status:'passed'});console.log('PASS '+name)}finally{clearTimeout(deadline)}};
await mkdir(out,{recursive:true});
try{
 await writeFile(out+'/catalog.json',sql('select coalesce(jsonb_agg(t),\'[]\') from ('+(await readFile('tests/migration-history/catalog.sql','utf8')).replace(/;\s*$/,'')+') t')+'\n');
 for(const file of ['qa-financial-opening-workspace.sql','qa-financial-opening-ledger.sql','qa-financial-opening-sources.sql','qa-financial-opening-first-activity.sql','qa-financial-opening-general-fiscal.sql'])await check('Actual PostgreSQL '+file,async()=>{const result=sql(await readFile('tests/'+file,'utf8'));await writeFile(out+'/'+file.replace('.sql','.json'),result+'\n');const parsed=JSON.parse(result),rows=Array.isArray(parsed)?parsed:parsed.checks;assert.ok(rows.length>0);assert.ok(rows.every(r=>r.passed===true))});
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
 sql(`insert into public.financial_fiscal_calendars(organization_id,start_month,start_day,retained_earnings_account,updated_by) values('${org}',1,1,'3300','${a.id}'),('${other}',1,1,'3300','${b.id}');`);
 const scope={p_org:org,p_fiscal_start:'2026-01-01'};
 await check('Real user sessions isolate opening source reads and reject forged metadata',async()=>{assert.ifError((await a.client.rpc('financial_opening_workspace',scope)).error);assert.ok((await b.client.rpc('financial_opening_workspace',scope)).error);assert.ifError((await viewer.client.auth.updateUser({data:{role:'OWNER',financial_core:{approve:true}}})).error);assert.ok((await viewer.client.rpc('save_financial_opening',{...scope,p_expected_version:0,p_source_revision:'x',p_entries:{},p_reason:''})).error)});
 const cookies=[],ssr=createServerClient(url,status.ANON_KEY,{cookies:{getAll:()=>cookies,setAll:cs=>{for(const c of cs){const i=cookies.findIndex(x=>x.name===c.name);if(i>=0)cookies.splice(i,1);cookies.push(c)}}}});assert.ifError((await ssr.auth.signInWithPassword({email:a.email,password:a.password})).error);
 const env={...process.env,NEXT_PUBLIC_SUPABASE_URL:url,NEXT_PUBLIC_SUPABASE_ANON_KEY:status.ANON_KEY,NEXT_PUBLIC_APP_URL:app,FINANCIAL_OPENING_WORKSPACE:'true',FINANCIAL_STATEMENTS_LIVE:'true',FINANCIAL_SOURCE_INTEGRITY_DIAGNOSTICS:'true',VERCEL_ENV:'preview'};
 const build=spawn('npm',['run','build'],{env,stdio:'inherit'});const buildExit=await new Promise((resolve,reject)=>{const deadline=setTimeout(()=>{build.kill('SIGTERM');reject(Error('ISOLATED_NEXT_BUILD_TIMEOUT'))},300000);build.on('error',e=>{clearTimeout(deadline);reject(e)});build.on('exit',code=>{clearTimeout(deadline);resolve(code)})});assert.equal(buildExit,0);
 const log=await open(out+'/next.log','w');server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3200'],{env,stdio:['ignore',log.fd,log.fd]});
 for(let i=0;i<180;i++){try{if((await fetch(app+'/api/financial-reporting/openings?action=context',{signal:AbortSignal.timeout(5000)})).status===401)break}catch{}await new Promise(r=>setTimeout(r,500));if(i===179)throw Error('NEXT_START_TIMEOUT')}
 const{chromium}=await import(process.env.FINANCIAL_SOURCE_BROWSER_MODULE);browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1672,height:941},acceptDownloads:true});await context.addCookies(cookies.map(c=>({name:c.name,value:c.value,domain:'localhost',path:'/',httpOnly:false,secure:false,sameSite:'Lax'})));page=await context.newPage();page.setDefaultTimeout(15000);page.setDefaultNavigationTimeout(20000);page.on('pageerror',e=>errors.push(e.message));
 await check('Financial setup reads real organization readiness, blocks fabricated completion and cross-tenant access',async()=>{
  const endpoint=app+'/api/financial-reporting/setup-readiness?';
  const params=new URLSearchParams({organization:org,mode:'EXISTING'});
  const own=await page.request.get(endpoint+params.toString());
  assert.equal(own.status(),200,'Owned organization readiness must be available');
  const ready=await own.json();
  assert.equal(ready.organizationId,org);
  assert.equal(ready.mode,'EXISTING');
  assert.equal(ready.statuses.chart,'READY','Legacy canonical 3300 chart must not require a new posting leaf');
  assert.equal(ready.statuses.fiscal,'READY','Existing valid fiscal year must stay valid');
  assert.equal(ready.statuses.posting,'IN_PROGRESS','No approved posting policy may not be treated as ready');
  assert.equal(ready.statuses.opening,'IN_PROGRESS','An unapproved opening may not be treated as ready');
  assert.equal(ready.ready,false);
  assert.equal(ready.certification,'NOT_CERTIFIED');
  const foreign=await page.request.get(endpoint+new URLSearchParams({organization:other,mode:'EXISTING'}));
  assert.equal(foreign.status(),403,'Cross-tenant setup evidence must be denied');
  await page.goto(app+'/en/settings/financial/setup?organization='+org);
  const savedKey='yaqeen:financial-setup:v1:'+org;
  await page.evaluate(({key})=>localStorage.setItem(key,JSON.stringify({
   mode:'EXISTING',industry:'GENERAL',
   completed:['organization','chart','fiscal','posting','banking','opening','users','review','finished'],
   step:'review'
  })),{key:savedKey});
  const reloaded=page.waitForResponse(response=>response.url().includes('/api/financial-reporting/setup-readiness?'));
  await page.reload();await reloaded;
  await page.getByRole('heading',{name:'Set up your organization'}).waitFor();
  await page.getByRole('heading',{name:'Review',exact:true}).waitFor();
  const finish=page.getByRole('button',{name:/Finish setup/});
  assert.equal(await finish.isDisabled(),true,'Local browser progress must not allow finish');
  assert.notEqual(await page.getByRole('progressbar').getAttribute('aria-valuenow'),'100',
   'Local review flags must never report 100% financial readiness');
  await page.screenshot({path:out+'/financial-setup-readiness-en-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.goto(app+'/ar/settings/financial/setup?organization='+org);
  await page.getByRole('heading',{name:'رحلة إعداد المؤسسة'}).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,
   'The financial setup page must remain within the mobile viewport');
  await page.screenshot({path:out+'/financial-setup-readiness-ar-mobile.png',fullPage:true});
  await page.evaluate(({key})=>localStorage.removeItem(key),{key:savedKey});
  await page.setViewportSize({width:1672,height:941});
 });
 async function chooseSetupStep(label){
  const button=page.locator('.financial-setup-stage-timeline button').filter({hasText:label});
  const group=button.locator('..');
  if(!(await button.isVisible()))await group.locator('summary').click();
  await button.click();
 }
 await check('The organization setup journey embeds real scoped workspaces without nested shell',async()=>{
  await page.goto(app+'/en/settings/financial/setup?organization='+org);
  await page.getByRole('heading',{name:'Set up your organization'}).waitFor();
  await page.getByRole('button',{name:/Existing organization/}).click();
  const embedded=page.locator('iframe.financial-setup-embedded-frame');
  assert.equal(await embedded.count(),0,'Setup forms must be native components, not framed pages');
  const embeddedPage=page.locator('[data-setup-native-workspace="organization"]');
  await embeddedPage.getByLabel('Organization name',{exact:true}).waitFor();
  assert.equal(await embeddedPage.locator('.corp-sidebar').count(),0,'Native form must not duplicate the shell');
  // The real original organization editor must refresh authoritative readiness
  // after a successful in-frame save, without taking the user out of this stage.
  const refreshedAfterSave=page.waitForResponse(response=>
   response.url().includes('/api/financial-reporting/setup-readiness?')&&response.status()===200);
  await embeddedPage.getByLabel('Legal name').fill('QA legal name updated inside setup');
  await embeddedPage.getByLabel('Country',{exact:true}).selectOption('SA');
  await embeddedPage.getByLabel('Official email',{exact:true}).fill('qa@example.com');
  await embeddedPage.getByLabel('Main activity',{exact:true}).fill('Trading');

  await embeddedPage.getByRole('button',{name:'Save changes'}).click();
  await embeddedPage.getByRole('status').filter({hasText:'Organization details saved.'}).waitFor();
  await refreshedAfterSave;
  const legalResponse=await page.request.get(app+'/api/organizations',{headers:{'cache-control':'no-cache'}});
  assert.equal(legalResponse.status(),200,'The legal identity must be readable under signed-in organization RLS');
  const savedLegal=(await legalResponse.json()).find(item=>item.id===org);
  assert.equal(savedLegal?.country_code,'SA');
  assert.equal(savedLegal?.contact_email,'qa@example.com');
  assert.equal(savedLegal?.activity,'Trading');

  await page.locator('[data-setup-native-workspace=organization]').waitFor();
  await chooseSetupStep('Cash & banking');
  const banking=page.locator('[data-setup-native-workspace="banking"]');
  await banking.waitFor();
  assert.equal(await embedded.count(),0,'Banking uses the real institutional component without an iframe');
  const bankResponse=await page.request.get(app+'/api/financial-register?scope=ORGANIZATION&organization_id='+org);
  assert.equal(bankResponse.status(),200,'The banking source must be authorized for this legal organization');
  await chooseSetupStep('Chart of accounts');
  await page.locator('[data-setup-native-workspace="chart"]').waitFor();
  await page.locator('.coa-page').waitFor();
  await page.locator('[data-setup-native-workspace="chart"] h1').filter({hasText:'Chart of accounts'}).waitFor();
  assert.equal(await embedded.count(),0,
    'Chart management must now be a native form in the same journey, without a nested frame');
  assert.equal(await page.locator('#corp-organization-controls .corp-organization-inner').count(),1,
    'The native chart must not insert a duplicate organization picker into the shared header');
  await page.screenshot({path:out+'/financial-setup-linked-chart-en-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  // CorporateShell transitions its reserved sidebar margin (250px -> 0)
  // over 220ms. Do not mistake the intermediate desktop-width layout for
  // a persistent mobile overflow immediately after changing the viewport.
  await page.waitForFunction(()=>{
    const workspace=document.querySelector('.corp-workspace');
    if(!workspace)return false;
    const box=workspace.getBoundingClientRect();
    return Math.abs(box.left)<2&&Math.abs(box.width-innerWidth)<2;
  },null,{timeout:5000});
  const mobileOverflow=await page.evaluate(()=>{
    const width=innerWidth;
    const offenders=Array.from(document.querySelectorAll('body *')).map(element=>{
      const rect=element.getBoundingClientRect(),style=getComputedStyle(element);
      return {tag:element.tagName.toLowerCase(),className:typeof element.className==='string'?element.className.slice(0,150):'',
        id:element.id||'',right:Math.round(rect.right),left:Math.round(rect.left),width:Math.round(rect.width),
        overflowX:style.overflowX,position:style.position};
    }).filter(element=>
      element.width>width+2||element.right>width+2||element.left< -2
    ).sort((a,b)=>a.right-b.right).slice(0,26);
    const keyNodes=['html','body','.corp-shell','.corp-workspace','.settings-workspace','.financial-setup',
      '.financial-setup-card','.financial-setup-native','.financial-setup-native-content',
      '.coa-page','.coa-template-panel','.coa-template-scroll','.coa-register','.coa-scroll'];
    const sizes=keyNodes.map(selector=>{
      const element=document.querySelector(selector);
      if(!element)return {selector,missing:true};
      const rect=element.getBoundingClientRect(),style=getComputedStyle(element);
      return {selector,right:Math.round(rect.right),width:Math.round(rect.width),
        clientWidth:element.clientWidth,scrollWidth:element.scrollWidth,
        overflowX:style.overflowX,minWidth:style.minWidth,display:style.display};
    });
    return {viewport:width,scrollWidth:document.documentElement.scrollWidth,offenders,sizes};
  });
  if(mobileOverflow.scrollWidth>mobileOverflow.viewport)
    console.log('FINANCIAL_SETUP_MOBILE_OVERFLOW '+JSON.stringify(mobileOverflow));
  assert.equal(mobileOverflow.scrollWidth>mobileOverflow.viewport,false,
    'Linked setup workspace must fit the mobile viewport');
  await page.screenshot({path:out+'/financial-setup-linked-chart-en-mobile.png',fullPage:true});
  await page.setViewportSize({width:1672,height:941});
 });
 await check('Setup tabs and deferred optional structure preserve organization and accounting gates',async()=>{
  await page.goto(app+'/en/settings/financial/setup?organization='+org);
  await page.getByRole('heading',{name:'Set up your organization'}).waitFor();
  assert.equal(await page.locator('.settings-tabs a').count(),6,
    'Exactly six approved settings sections should appear without changing the corporate sidebar');
  assert.equal(await page.locator('.settings-tabs a').filter({hasText:'Legal & tax settings'}).count(),1);
  assert.equal(await page.locator('.settings-tabs a').filter({hasText:'Users & permissions'}).count(),1);
  const journey=page.locator('.settings-tabs a').filter({hasText:'Setup journey'});
  assert.equal(await journey.getAttribute('aria-current'),'page',
    'Setup journey must be its own active tab, not a finance shortcut');
  await chooseSetupStep('Branches & structure');
  const defer=page.getByRole('button',{name:/Defer for now/});
  await defer.waitFor();
  await defer.click();
  const branchStep=page.locator('.financial-setup-stage-timeline button').filter({hasText:'Branches & structure'});
  if(!(await branchStep.isVisible()))await branchStep.locator('..').locator('summary').click();
  await branchStep.waitFor();
  assert.match(await branchStep.innerText(),/Deferred/,
    'Deferred step must stay visible and must never be shown as complete');
  assert.notEqual(await page.getByRole('progressbar').getAttribute('aria-valuenow'),'100',
    'Deferral cannot forge financial readiness');
  // The original VAT profile, invoice seller address and ZATCA invoice unit
  // must all be reachable in the unified setup journey without duplicating
  // their persisted tables or changing the independent accounting preflight.
  await chooseSetupStep('Legal & tax settings');
  const legal=page.locator('[data-setup-native-workspace="regulatory"]');
  await legal.getByLabel('Registered legal address',{exact:true}).waitFor();
  await legal.getByLabel('Registered legal address',{exact:true}).fill('Riyadh QA test address');
  await legal.getByLabel('Commercial or statutory registration number',{exact:true}).fill('123456789');
  await legal.getByRole('button',{name:'Save changes',exact:true}).click();
  await legal.getByText('Organization details saved.',{exact:true}).waitFor();
  const legalSaved=(await (await page.request.get(app+'/api/organizations')).json()).find(x=>x.id===org);
  assert.equal(legalSaved.registered_address,'Riyadh QA test address');
  assert.equal(legalSaved.commercial_registration_number,'123456789');
  await legal.getByRole('button',{name:'Tax & e-invoicing',exact:true}).click();
  await legal.locator('.financial-setup-regulatory-editor').waitFor();
  await legal.locator('.console-tabs').getByRole('button',{name:'National address',exact:true}).click();
  await legal.getByLabel('Street',{exact:true}).waitFor();
  assert.equal(await legal.locator('.console-tabs').getByRole('button',{name:'National address',exact:true}).getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('iframe').count(),0,'All legal identity and tax editing remains native');
  const registrationTab=legal.locator('.console-tabs').getByRole('button',{name:'Registration',exact:true});
  await registrationTab.click();
  await page.waitForFunction(()=>{
    const root=document.querySelector('[data-setup-native-workspace="regulatory"]');
    const tab=[...(root?.querySelectorAll('.console-tabs button')??[])].find(el=>el.textContent?.trim()==='Registration');
    return tab?.getAttribute('aria-pressed')==='true';
  },undefined,{timeout:15000});
  const registrationControl=legal.locator('select[name="registration_status"]');
  await registrationControl.waitFor({state:'attached'});
  const registrationVisible=await registrationControl.evaluate(el=>{
    const section=el.closest('div.request-form');
    const style=getComputedStyle(el);
    return {hidden:Boolean(section?.hasAttribute('hidden')),display:style.display,visibility:style.visibility,rects:el.getClientRects().length};
  });
  await page.screenshot({path:out+'/financial-setup-legal-registration-en-desktop.png',fullPage:true});
  assert.ok(!registrationVisible.hidden&&registrationVisible.display!=='none'&&
    registrationVisible.visibility!=='hidden'&&registrationVisible.rects>0,
    'After selecting Registration the original VAT status field must be visible: '+JSON.stringify(registrationVisible));
  assert.equal(await page.getByRole('progressbar').getAttribute('aria-valuenow')!==null,true,
    'Legal/tax review must not replace real financial readiness');
  await page.screenshot({path:out+'/financial-setup-legal-tax-en-desktop.png',fullPage:true});
  await page.locator('.settings-tabs a').filter({hasText:'Financial & accounting settings'}).click();
  await page.getByRole('heading',{name:'Financial & accounting settings',exact:true,level:1}).waitFor();
  assert.equal(await page.locator('.settings-tabs a').filter({hasText:'Financial & accounting settings'}).getAttribute('aria-current'),'page',
    'Financial settings tab should be active, not the journey');
  await page.locator('.settings-tabs a').filter({hasText:'Setup journey'}).click();
  await page.getByRole('heading',{name:'Set up your organization'}).waitFor();
  const restored=page.locator('.financial-setup-stage-timeline button').filter({hasText:'Branches & structure'});
  await restored.locator('..').locator('summary').click();
  await restored.waitFor();
  const resume=page.getByRole('button',{name:/Continue setup/});
  await resume.waitFor();
  assert.ok((await resume.innerText()).includes('First incomplete setup requirement'),
   'Resume must identify the next saved organization or verified financial requirement, not fabricated local completion');
  assert.match(await restored.innerText(),/Deferred/,
    'Deferred step should survive navigation between settings tabs');
  await page.screenshot({path:out+'/financial-setup-journey-navigation-en-desktop.png',fullPage:true});
 });
 await check('An authorized organization without an approved opening exposes its three in-year vouchers',async()=>{
  sql(`insert into public.organization_members(organization_id,user_id,role,status) values('${other}','${a.id}','OWNER','ACTIVE');
   do $$ declare asset uuid; d date; begin
    perform set_config('request.jwt.claim.sub','${b.id}',true);
    insert into public.liquidity_accounts(organization_id,name,account_type,currency,current_balance,current_balance_base,created_by,metadata)
     values('${other}','September QA bank','BANK','SAR',250000,250000,'${b.id}','{"opening_date":"2026-09-28","opening_balance":250000}');
    foreach d in array array[date '2026-01-01',date '2026-10-21',date '2026-10-23'] loop
     insert into public.asset_accounts(user_id,organization_id,ownership_scope,asset_type,name,currency,metadata)
      values('${b.id}','${other}','ORGANIZATION','OTHER','Opening QA '||d,'SAR','{"acquisition_mode":"OPENING_BALANCE"}') returning id into asset;
     insert into public.transactions(user_id,organization_id,asset_account_id,transaction_type,transaction_date,quantity,currency,base_currency,base_value,gross_value,metadata)
      values('${b.id}','${other}',asset,'OPENING_BALANCE',d,1,'SAR','SAR',100,100,'{}');
    end loop;
   end $$;`);
  await page.goto(app+'/en/financial-reports?screen=kpis&organization='+org);
  const picker=page.locator('#corp-organization-controls').getByRole('combobox',{name:'Organization',exact:true});
  await picker.locator('option[value="'+other+'"]').waitFor({state:'attached'});
  assert.equal(await picker.isEnabled(),true);await picker.selectOption(other);
  await page.getByRole('heading',{name:'Sources and registers',exact:true}).waitFor();
  // The cash register remains available in its own source, but must never be
  // presented as a substitute for a financial statement with no approved policy.
  assert.equal(await page.getByRole('row').filter({hasText:'September QA bank'}).count(),0);
  await page.getByText('Cash balances are not shown as a partial financial position when the complete statement is unavailable.',{exact:false}).waitFor();
  await page.getByRole('link',{name:'Opening balances and vouchers'}).click();
  await page.getByRole('tab',{name:/Assets & depreciation/}).click();
  const vouchers=page.locator('[data-period-voucher]');
  await vouchers.first().waitFor();assert.equal(await vouchers.count(),2);
  for(const date of ['2026-10-21','2026-10-23'])assert.match(await vouchers.allTextContents().then(v=>v.join(' ')),new RegExp(date));
  assert.equal(await page.getByText('Assign late opening sources',{exact:true}).count(),0);
  assert.equal(await page.getByLabel('Reason for replacing the previous approval').count(),0);
  const lateAsset=page.locator('[data-opening-row^="asset:"]').filter({hasText:'Opening QA 2026-10-21'});
  const rowHeight=await lateAsset.evaluate(row=>row.getBoundingClientRect().height);
  await lateAsset.getByRole('button',{name:'Review assignment',exact:true}).click();
  const review=page.getByRole('dialog',{name:'Review assignment'});
  await review.getByText('2026-10-21',{exact:true}).waitFor();
  assert.equal(await lateAsset.evaluate(row=>row.getBoundingClientRect().height),rowHeight);
  assert.equal(await review.getByRole('button',{name:'Confirm assignment'}).isEnabled(),false);
  await review.getByLabel('Reason for assigning to fiscal start').fill('Confirmed ownership at the start of the year');
  assert.equal(await review.getByRole('button',{name:'Confirm assignment'}).isEnabled(),true);
  await page.screenshot({path:out+'/opening-asset-review-desktop.png'});
  await review.getByRole('button',{name:'Cancel'}).click();
  const dataFor=async fiscalStart=>{
   const response=await page.request.get(app+'/api/financial-reporting/openings?'+new URLSearchParams({organization:other,fiscalStart}));
   assert.equal(response.status(),200);return response.json();
  };
  const current=await dataFor('2026-01-01'),next=await dataFor('2027-01-01');
  for(const voucher of current.periodAssetOpenings){
   const id='asset:'+voucher.assetId;
   assert.equal(current.source.rows.find(row=>row.id===id).vouchers.length,voucher.date==='2026-01-01'?1:0);
   const carried=next.source.rows.find(row=>row.id===id).vouchers;
   assert.equal(carried.length,1);assert.equal(Number(carried[0].debit),Number(voucher.amount));
  }
  assert.equal(next.periodAssetOpenings.length,0);
  const bank=current.source.rows.find(row=>row.ar==='September QA bank');
  assert.equal(bank.vouchers.length,0);assert.equal(Number(current.bankRegister[bank.id].balance),250000);
  assert.equal(Number(next.source.rows.find(row=>row.id===bank.id).vouchers[0].debit),250000);
  sql(`update public.organization_members set status='INACTIVE' where organization_id='${other}' and user_id='${a.id}'`);
 });
 await check('An ordinary browser user declares a late bank opening without technical IDs or copying its current balance',async()=>{
  sql(`update public.organization_members set status='ACTIVE' where organization_id='${other}' and user_id='${a.id}'`);
  assert.ifError((await a.client.rpc('link_financial_cash_accounts',{p_org:other})).error);
  await page.goto(app+'/en/opening-balances?organization='+org);await page.locator('[data-opening-ready="'+org+'"]').waitFor();
  const organizationPicker=page.locator('#corp-organization-controls').getByRole('combobox',{name:'Organization',exact:true});await organizationPicker.selectOption(other);await page.locator('[data-opening-ready="'+other+'"]').waitFor();
  const fiscalLink=page.getByRole('link',{name:'Manage fiscal years in organization settings',exact:true});assert.match(await fiscalLink.getAttribute('href'),new RegExp(other));await fiscalLink.click();await page.locator('[data-fiscal-management]').waitFor();assert.equal(await page.getByRole('navigation',{name:'Settings sections'}).getByRole('link',{name:'Financial & accounting settings',exact:true}).getAttribute('aria-current'),'page');await page.getByRole('navigation',{name:'Settings sections'}).getByRole('link',{name:'Organization settings',exact:true}).click();await page.getByRole('heading',{name:'Organization settings',exact:true,level:1}).waitFor();assert.equal(await page.locator('#corp-organization-controls').getByRole('combobox',{name:'Selected organization'}).inputValue(),other);await page.goto(app+'/en/opening-balances');await page.locator('[data-opening-ready="'+other+'"]').waitFor();assert.equal(await page.getByRole('combobox',{name:'Organization',exact:true}).inputValue(),other);

  await page.getByRole('tab',{name:'Cash & banks'}).click();
  const bankRow=page.locator('[data-opening-row]').filter({hasText:'September QA bank'});
  await bankRow.getByRole('button',{name:'Review bank opening',exact:true}).click();
  const bankDialog=page.getByRole('dialog',{name:'Review bank opening'});
  const bankAmount=bankDialog.getByRole('textbox');
  await bankAmount.fill('250,00');
  assert.equal(await bankDialog.getByRole('button',{name:'Confirm bank opening'}).isEnabled(),false);
  await bankAmount.fill('0');
  await page.setViewportSize({width:390,height:844});
  await page.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth,null,{timeout:5000}).catch(async error=>{await writeFile(out+'/late-source-mobile-overflow.json',JSON.stringify(await page.evaluate(()=>Array.from(document.querySelectorAll('*')).map(e=>({tag:e.tagName,classes:e.className,left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right,text:e.textContent?.slice(0,100)})).filter(e=>e.right>innerWidth+1&&e.left>=0).slice(-25)),null,2));await page.screenshot({path:out+'/late-source-mobile.png',fullPage:true});throw error});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:out+'/opening-bank-review-mobile.png'});await page.setViewportSize({width:1672,height:941});
  const assigned=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/financial-reporting/fiscal'&&r.request().method()==='POST');await page.getByRole('button',{name:'Confirm bank opening',exact:true}).click();assert.equal((await assigned).status(),200);
  await page.locator('[data-opening-row][data-final="0.0000"]').filter({hasText:'September QA bank'}).waitFor();
  const fresh=await a.client.rpc('financial_opening_workspace',{p_org:other,p_fiscal_start:'2026-01-01'});assert.ifError(fresh.error);
  const bank=fresh.data.source.rows.find(row=>row.en==='September QA bank');assert.equal(bank.vouchers[0].debit,'0.0000');assert.equal(Number(fresh.data.bankRegister[bank.id].balance),250000);
  assert.equal(bank.vouchers[0].effectiveDate,'2026-01-01');assert.equal(bank.vouchers[0].transactionDate,'2026-09-28');
  sql(`update public.organization_members set status='INACTIVE' where organization_id='${other}' and user_id='${a.id}'`);
 });
 await check('Connected opening page loads actual master names and missing states',async()=>{await page.goto(app+'/ar/opening-balances');await page.locator('[data-opening-ready="'+org+'"]').waitFor();await page.getByText('عميل بلا رصيد افتتاحي',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'اعتماد الأرصدة',exact:true}).isDisabled(),true);await page.screenshot({path:out+'/opening-ar-desktop-before.png',fullPage:true})});
 await check('Cash row shows current register value independently of fiscal opening',async()=>{
  await page.locator('#ob-tab-cash').click();
  const row=page.locator('[data-opening-row="cash:'+cash+'"]');
  assert.equal(await row.getAttribute('data-final'),'500.0000');
  assert.match(await row.locator('td[data-label="رصيد السجل الحالي"]').innerText(),/500.00 SAR/);
  await page.locator('#ob-tab-customers').click();
 });
 await check('Persisted draft distinguishes confirmed zero, reopens after refresh, and approves',async()=>{
  await page.getByRole('button',{name:'تأكيد رصيد صفري',exact:true}).click();await page.getByRole('tab',{name:/^حقوق الملكية/}).click();
  await page.getByLabel('الإضافة: رأس المال',{exact:true}).fill('500');for(const name of ['الاحتياطيات','الأرباح المحتجزة'])await page.locator('tr').filter({has:page.getByLabel('الإضافة: '+name,{exact:true})}).getByRole('button',{name:'تأكيد رصيد صفري',exact:true}).click();
  for(const tab of ['customers','suppliers','cash','assets','loans','advances','other','equity']){
   await page.locator('#ob-tab-'+tab).click();
   const zero=page.getByRole('button',{name:'تأكيد رصيد صفري',exact:true});
   while(await zero.count())await zero.first().click();
  }
  const saved=page.waitForResponse(r=>r.url().endsWith('/api/financial-reporting/openings')&&r.request().method()==='POST');await page.getByRole('button',{name:'حفظ المسودة',exact:true}).click();const savedResponse=await saved;assert.equal(savedResponse.status(),200,JSON.stringify(await savedResponse.json()));await page.locator('[data-opening-ready="'+org+'"]').waitFor();await page.reload();await page.locator('[data-opening-ready="'+org+'"]').waitFor();await page.getByRole('tab',{name:/^حقوق الملكية/}).click();assert.equal(await page.getByLabel('الإضافة: رأس المال',{exact:true}).inputValue(),'500');
  const approved=page.waitForResponse(r=>r.url().endsWith('/api/financial-reporting/openings')&&r.request().method()==='POST');await page.getByRole('button',{name:'اعتماد الأرصدة',exact:true}).click();const approvedResponse=await approved;assert.equal(approvedResponse.status(),200,JSON.stringify(await approvedResponse.json()));await page.getByText(/معتمد ·/).waitFor();await page.getByRole('tab',{name:/^حقوق الملكية/}).click();assert.equal(await page.getByLabel('الإضافة: رأس المال',{exact:true}).isDisabled(),true);
  const read=await a.client.rpc('financial_opening_workspace',scope);assert.ifError(read.error);assert.equal(read.data.workspace.status,'APPROVED');assert.equal(read.data.workspace.entries['equity:3100'].amount,'500');
 });
 await check('Browser Excel export preserves actual source marker, source amount and final opening',async()=>{const d=page.waitForEvent('download');await page.getByRole('button',{name:'تصدير Excel',exact:true}).click();const file=await d;await file.saveAs(out+'/opening-approved.xlsx');const{default:ExcelJS}=await import('exceljs'),book=new ExcelJS.Workbook();await book.xlsx.readFile(await file.path());assert.equal(book.worksheets.length,2);assert.match(String(book.worksheets[1].getCell('A1').value),/LIVE REGISTERS/);assert.ok(book.worksheets[1].rowCount>=7)});
 await check('Posting policy UI saves and approves a real initial policy',async()=>{await page.goto(app+'/ar/financial-reporting-policy');await page.getByRole('heading',{name:'قواعد ترحيل القوائم المالية'}).waitFor();await page.getByLabel('سبب الإعداد أو التغيير').fill('إعداد قواعد المرحلة الافتتاحية');await page.getByRole('button',{name:'حفظ المسودة',exact:true}).click();await page.getByRole('button',{name:'اعتماد القواعد',exact:true}).click();await page.getByRole('button',{name:'إعداد نسخة جديدة',exact:true}).waitFor();const r=await a.client.rpc('financial_statement_live_snapshot',{p_org:org,p_from:'2026-01-01',p_to:'2026-12-31'});assert.ifError(r.error);assert.equal(r.data.origin,'LIVE_CANONICAL_EVENTS')});
 for(const lang of ['ar','en'])for(const width of [1672,390])await check('Actual approved page layout '+lang+' '+width,async()=>{await page.setViewportSize({width,height:width===390?844:941});await page.goto(app+'/'+lang+'/opening-balances');await page.locator('[data-opening-ready="'+org+'"]').waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);const selector=page.locator('#corp-organization-controls select');await selector.waitFor();assert.ok(await selector.evaluate(el=>el.getBoundingClientRect().width>=100&&el.closest('#corp-organization-controls').clientWidth>=100&&el.closest('.corp-topbar').getBoundingClientRect().bottom>=el.getBoundingClientRect().bottom));await page.screenshot({path:out+`/opening-${lang}-${width}.png`,fullPage:true});await page.goto(app+'/'+lang+'/financial-reports');await page.locator('[data-statement-ready="overview"]').waitFor();assert.match(await page.locator('.fs-metrics').first().innerText(),/0.00/);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:out+`/statements-${lang}-${width}.png`,fullPage:true})});
 await check('Personal position opens from reporting and only reads the signed-in owner cash register',async()=>{
  await page.setViewportSize({width:1672,height:941});
  sql(`insert into public.asset_accounts(user_id,ownership_scope,asset_type,name,currency) values
    ('${a.id}','PERSONAL','CASH','Owner QA personal cash','SAR'),('${b.id}','PERSONAL','CASH','Other QA personal cash','SAR');`);
  await page.goto(app+'/en/dashboard?scope=PERSONAL');
  const menu=page.getByRole('button',{name:/Financial reports & statements/i});
  if(await menu.getAttribute('aria-expanded')!=='true')await menu.click();
  const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/financial-register'&&new URL(r.url()).searchParams.get('scope')==='PERSONAL');
  await page.getByRole('link',{name:'Personal financial position summary',exact:true}).click();
  const read=await response;assert.equal(read.status(),200);const data=await read.json();
  assert.equal(new URL(page.url()).searchParams.get('scope'),'PERSONAL');
  assert.ok(data.accounts.some(x=>x.name==='Owner QA personal cash'));
  assert.ok(data.accounts.every(x=>x.organizationId===null&&x.name!=='Other QA personal cash'));
 });
 await check('Financial reports open in Business from either dashboard scope',async()=>{
  await page.setViewportSize({width:1672,height:941});
  for(const scope of ['PERSONAL','ORGANIZATION']){
   await page.goto(app+'/en/dashboard?scope='+scope+'&organization='+org);
   const menu=page.getByRole('button',{name:/Financial reports & statements/i});
   if(await menu.getAttribute('aria-expanded')!=='true')await menu.click();
   await page.getByRole('link',{name:'Financial position',exact:true}).click();
   await page.locator('[data-statement-ready="position"]').waitFor();
   assert.equal(await page.getByRole('button',{name:'Business',exact:true}).getAttribute('aria-pressed'),'true');
   const url=new URL(page.url());assert.equal(url.searchParams.get('organization'),org);assert.equal(url.searchParams.get('screen'),'position');
  }
  await page.goto(app+'/en/financial-reports?screen=position&organization='+other);
  await page.getByRole('heading',{name:'No authorized statement sources'}).waitFor();
  assert.equal(await page.locator('[data-statement-ready]').count(),0);
 });
 await check('Expired subscription keeps authorized reads and blocks opening writes',async()=>{sql(`update public.platform_subscriptions set trial_started_at=now()-interval '31 days',trial_ends_at=now()-interval '1 day' where organization_id='${org}'`);const r=await a.client.rpc('financial_opening_workspace',scope);assert.ifError(r.error);assert.equal(r.data.canSave,false);assert.equal(r.data.canApprove,false);assert.ok((await a.client.rpc('save_financial_opening',{...scope,p_expected_version:0,p_source_revision:r.data.source.revision,p_entries:{},p_reason:''})).error);sql(`update public.platform_subscriptions set trial_started_at=now(),trial_ends_at=now()+interval '30 days' where organization_id='${org}'`)});
 await check('Paid supplier invoice credit from register to financial position',async()=>{
  const contact='a0900000-0000-4000-8000-000000000001';
  sql(`insert into public.vat_profiles(organization_id,registration_status,tax_registration_number) values('${org}','REGISTERED','310000000000003') on conflict(organization_id) do update set registration_status='REGISTERED',tax_registration_number=excluded.tax_registration_number;
  insert into public.organization_entities(organization_id,name) select '${org}','Refund QA' where not exists(select 1 from public.organization_entities where organization_id='${org}' and active);
  insert into public.vat_contacts(id,organization_id,contact_type,name,created_by) values('${contact}','${org}','SUPPLIER','QA refund supplier','${a.id}');
  insert into public.financial_classifications(organization_id,code,name,classification_type,created_by) select '${org}',type,type,type,'${a.id}' from unnest(array['OPEX','TAX','PAYABLE']) type on conflict(organization_id,code) do nothing;`);
  async function expectResponse(response,status){
    const body=await response.json();
    if(response.status()!==status){
     // Logs belong to this disposable local QA stack only. Surface sanitized
     // diagnostic codes, never a full SQL statement or user/tenant data.
     const log=await readFile(out+'/next.log','utf8');
     console.log('ISOLATED_REPORTING_SOURCE_CODES',log.split('\n')
      .filter(line=>line.includes('REPORTING_QA_DIAGNOSTIC_CODE'))
      .slice(-8).map(line=>line.match(/REPORTING_QA_DIAGNOSTIC_CODE\s+([A-Z_]+)/)?.[1]??'UNKNOWN'));
    }
    assert.equal(response.status(),status,JSON.stringify(body));return body;
   }
  const req=page.request,scope={organization_id:org};
  const invoice=await expectResponse(await req.post(app+'/api/vat',{data:{...scope,action:'add_document',document_number:'QA-PUR-01',document_type:'PURCHASE',document_kind:'INVOICE',transaction_date:'2026-02-01',due_date:'2026-02-01',counterparty_name:'QA refund supplier',counterparty_contact_id:contact,supply_type:'STANDARD',net_amount:100,recoverable_percent:50,currency:'SAR',exchange_rate:1}}),201);
  await expectResponse(await req.post(app+'/api/vat/recognition',{data:{...scope,document_id:invoice.id}}),200);
  await expectResponse(await req.patch(app+'/api/liquidity/'+invoice.financial_core.cash_flow_id,{data:{status:'ACTUAL',amount:115,account_id:cash,settlement_date:'2026-02-02'}}),200);
  async function actions(number){
   await page.goto(app+'/en/vat?section=unified&organization_id='+org);
   const row=page.locator('.vat-unified-table tbody tr').filter({hasText:number});
   const trigger=row.locator('.invoice-actions-trigger');await trigger.scrollIntoViewIfNeeded();
   await page.evaluate(()=>document.fonts.ready);
   for(let attempt=0;attempt<3;attempt++){
    if(await trigger.getAttribute('aria-expanded')!=='true')await trigger.click();
    try{await row.getByRole('button',{name:'Actions',exact:true}).click({timeout:4000});break}catch(error){if(attempt===2)throw error}
   }
  }
  await actions('QA-PUR-01');
  await page.getByRole('button',{name:'Linked credit note',exact:true}).click();
  await page.getByLabel('Document number',{exact:true}).fill('QA-CREDIT-46');
  await page.getByLabel('Document date',{exact:true}).fill('2026-03-01');
  await page.getByLabel('Due date',{exact:true}).fill('2026-03-01');
  await page.getByLabel('Net before VAT',{exact:true}).fill('40');
  await page.getByLabel('Notes / note reason',{exact:true}).fill('Partial return after full payment');
  const saved=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/vat'&&r.request().method()==='POST');
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await expectResponse(await saved,201);
  await actions('QA-CREDIT-46');
  const posted=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/vat/notes'&&r.request().method()==='POST');
  await page.getByRole('button',{name:'Post accounting',exact:true}).click();
  await expectResponse(await posted,200);
  const input={p_org:org,p_fiscal_start:'2026-01-01'};
  const policy=await a.client.rpc('financial_reporting_policy_workspace',input);assert.ifError(policy.error);
  const rules=new Map();
  for(const e of policy.data.events)for(const l of e.lines){
   const supplierRefund=l.classificationId==='VAT_NOTE_REFUND_RECEIVABLE',payment=l.cashDirection==='OUTFLOW';
   const rule={eventType:e.eventType,sourceModule:e.sourceModule,classificationId:l.classificationId,cashDirection:l.cashDirection,debitAccountId:payment?'2100':supplierRefund?'1800':l.classificationId.endsWith(':INPUT_VAT_RECOVERABLE')?'1400':'6100',creditAccountId:payment?'1000':'2100',...(payment?{cashActivity:'OPERATING'}:{})};
   rules.set(JSON.stringify(rule),rule);
  }
  const draft=await a.client.rpc('save_financial_reporting_policy',{...input,p_expected_version:0,p_rules:[...rules.values()],p_reason:'Map supplier refund separately from original payable'});assert.ifError(draft.error);
  const ap=await a.client.rpc('approve_financial_reporting_policy',{p_id:draft.data.id,p_expected_version:draft.data.version});assert.ifError(ap.error);
  const query='/api/financial-reporting/live-statements?action=statements&organization='+org+'&from=2026-01-01&to=';
  const before=await expectResponse(await req.get(app+query+'2026-02-28'),200);
  const after=await expectResponse(await req.get(app+query+'2026-03-31'),200);
  assert.equal(before.statements.cash.closing,'385.0000');assert.equal(after.statements.cash.closing,before.statements.cash.closing);
  assert.equal(after.accounts.find(x=>x.id==='1800').balance,'46.0000');assert.equal(after.accounts.find(x=>x.id==='2100').balance,'0.0000');
  assert.equal(after.statements.income.operatingExpenses,'64.5000');assert.equal(after.statements.position.assets,'435.5000');
  await page.goto(app+'/en/financial-reports?screen=position');
  const position=page.locator('[data-statement-ready="position"]');await position.waitFor();
  assert.match(await position.innerText(),/435\.50/);
  await page.screenshot({path:out+'/supplier-credit-financial-position.png',fullPage:true});
 });
 await check('Real funded borrowing and lending reconcile to institutional statements once',async()=>{
  const loanOrg='b1000000-0000-4000-8000-000000000003';
  const loanBank='b2000000-0000-4000-8000-000000000003';
  const loanParty='b3000000-0000-4000-8000-000000000003';
  sql(`select set_config('request.jwt.claim.sub','${a.id}',false);
    insert into public.organizations(id,owner_user_id,name) values('${loanOrg}','${a.id}','ZZ QA funded debt');
    insert into public.organization_members(organization_id,user_id,role,status) values('${loanOrg}','${a.id}','OWNER','ACTIVE') on conflict(organization_id,user_id) do update set role='OWNER',status='ACTIVE';
    insert into public.liquidity_accounts(id,organization_id,name,account_type,currency,current_balance,current_balance_base,created_by,metadata)
      values('${loanBank}','${loanOrg}','QA funding bank','BANK','SAR',0,0,'${a.id}','{"opening_date":"2026-01-01","opening_balance":0,"opening_fx_rate":1}');
    insert into public.liquidity_counterparties(id,organization_id,name,party_type,created_by)
      values('${loanParty}','${loanOrg}','QA debt counterparty','CUSTOMER','${a.id}');`);
  const loanScope={p_org:loanOrg,p_fiscal_start:'2026-01-01'};
  const recorded=[];
  for(const [side,amount,expectedDirection] of [['PAYABLE',300,'INFLOW'],['RECEIVABLE',200,'OUTFLOW']]){
    const payload={organization_id:loanOrg,request_id:randomUUID(),kind:'LOAN',mode:'NEW',side,
      counterparty_id:loanParty,entity_id:null,account_id:loanBank,
      category:side==='PAYABLE'?'O_AP_LOAN':'O_AR_LOAN',
      description:'QA actual cash funded '+side,reference:'QA-FUND-'+side,
      date:'2026-02-10',currency:'SAR',exchange_rate:1,principal:amount,
      schedule:[{amount,due_date:'2026-12-01'}]};
    const created=await a.client.rpc('create_debt_contract',{p_payload:payload});assert.ifError(created.error);
    assert.equal(created.data.status,'COMMITTED');
    const before=await a.client.rpc('financial_reporting_policy_workspace',loanScope);assert.ifError(before.error);
    assert.equal(before.data.events.filter(e=>e.sourceModule==='DEBT_CONTRACTS').length,recorded.length);
    assert.ifError((await a.client.rpc('approve_financial_event',{p_event_id:created.data.eventId,p_note:'Isolated real debt QA'})).error);
    const posted=await a.client.rpc('post_debt_contract',{p_id:created.data.id});assert.ifError(posted.error);
    assert.equal(posted.data.status,'ACTUAL');
    assert.ifError((await a.client.rpc('post_debt_contract',{p_id:created.data.id})).error);
    const actual=sql(`select cash_direction from public.financial_event_lines where event_id='${created.data.eventId}'`);
    assert.equal(actual,expectedDirection);
    recorded.push(created.data.eventId);
  }
  assert.equal(Number(sql(`select count(*) from public.liquidity_settlements where organization_id='${loanOrg}' and source_module='DEBT_FUNDING'`)),2);
  assert.equal(Number(sql(`select current_balance from public.liquidity_accounts where id='${loanBank}'`)),100);
  const workspace=await a.client.rpc('financial_reporting_policy_workspace',loanScope);assert.ifError(workspace.error);
  const debtEvents=workspace.data.events.filter(e=>e.sourceModule==='DEBT_CONTRACTS');
  assert.equal(debtEvents.length,2);
  const rules=[];
  for(const e of debtEvents)for(const l of e.lines){
    const incoming=l.cashDirection==='INFLOW';assert.ok(incoming||l.cashDirection==='OUTFLOW');
    rules.push({eventType:e.eventType,sourceModule:e.sourceModule,classificationId:l.classificationId,
      cashDirection:l.cashDirection,debitAccountId:incoming?'1000':'1200',
      creditAccountId:incoming?'2200':'1000',cashActivity:incoming?'FINANCING':'INVESTING'});
  }
  const draft=await a.client.rpc('save_financial_reporting_policy',{...loanScope,
    p_expected_version:0,p_rules:rules,p_reason:'Real funding and non-duplicated principal recognition'});assert.ifError(draft.error);
  assert.ifError((await a.client.rpc('approve_financial_reporting_policy',{p_id:draft.data.id,p_expected_version:draft.data.version})).error);
  const reportResponse=await page.request.get(app+'/api/financial-reporting/live-statements?'+new URLSearchParams({
    action:'statements',organization:loanOrg,from:'2026-01-01',to:'2026-12-31'}));
  const report=await reportResponse.json();
  assert.equal(reportResponse.status(),200,JSON.stringify(report));
  assert.deepEqual(new Set(report.statements.sourceJournalIds),new Set(recorded));
  assert.equal(report.statements.cash.investing,'-200.0000');
  assert.equal(report.statements.cash.financing,'300.0000');
  assert.equal(report.statements.cash.closing,'100.0000');
  assert.equal(report.statements.position.assets,'300.0000');
  assert.equal(report.statements.position.liabilities,'300.0000');
  assert.equal(report.statements.income.netProfit,'0.0000');
  assert.ok((await b.client.rpc('financial_statement_live_snapshot',{p_org:loanOrg,p_from:'2026-01-01',p_to:'2026-12-31'})).error);
 });
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
    assert.equal(await tab.getByText('Fiscal calendar and annual close',{exact:true}).count(),0);
    assert.equal(await tab.getByRole('button',{name:'CSV',exact:true}).count(),0);
   }
   assert.deepEqual(downloads,[]);
  }finally{await exportPage.close()}
 });
 await check('Concurrent annual close retries are atomic and real amount-limited users cannot close',async()=>{
  const fiscalOrg=randomUUID(),fiscalBank=randomUUID(),request=randomUUID();
  sql(`select set_config('request.jwt.claim.sub','${a.id}',false);
   insert into public.organizations(id,owner_user_id,name) values('${fiscalOrg}','${a.id}','ZZ independent concurrent fiscal fixture');
   insert into public.organization_members(organization_id,user_id,role,status) values('${fiscalOrg}','${a.id}','OWNER','ACTIVE'),('${fiscalOrg}','${b.id}','VIEWER','ACTIVE') on conflict(organization_id,user_id) do update set role=excluded.role,status='ACTIVE';
   insert into public.organization_member_permission_overrides(organization_id,user_id,permission,effect,amount_limit,currency,created_by)
    values('${fiscalOrg}','${b.id}','financial_core.view','ALLOW',null,null,'${a.id}'),('${fiscalOrg}','${b.id}','financial_core.approve','ALLOW',50,'SAR','${a.id}'),('${fiscalOrg}','${b.id}','financial_core.post','ALLOW',50,'SAR','${a.id}');
   insert into public.liquidity_accounts(id,organization_id,name,account_type,currency,current_balance,current_balance_base,created_by,metadata)
    values('${fiscalBank}','${fiscalOrg}','Concurrent close bank','BANK','SAR',100,100,'${a.id}','{"opening_date":"2023-12-31","opening_balance":100,"opening_fx_rate":1}');`);
  assert.ifError((await a.client.rpc('save_financial_fiscal_calendar',{p_org:fiscalOrg,p_month:1,p_day:1,p_retained:'3300',p_expected_version:0,p_reason:'Independent concurrent calendar'})).error);
  const opening=await a.client.rpc('financial_opening_workspace',{p_org:fiscalOrg,p_fiscal_start:'2024-01-01'});assert.ifError(opening.error);
  const entries=Object.fromEntries(opening.data.source.rows.filter(row=>row.vouchers.length===0).map(row=>[row.id,{amount:'0',side:row.normal}]));entries['equity:3100']={amount:'100',side:'CREDIT'};
  const draft=await a.client.rpc('save_financial_opening',{p_org:fiscalOrg,p_fiscal_start:'2024-01-01',p_expected_version:0,p_source_revision:opening.data.source.revision,p_entries:entries,p_reason:'Balanced source trial for concurrent close'});assert.ifError(draft.error);
  assert.ifError((await a.client.rpc('approve_financial_opening',{p_id:draft.data.id,p_expected_version:1})).error);
  const policy=await a.client.rpc('save_financial_reporting_policy',{p_org:fiscalOrg,p_fiscal_start:'2024-01-01',p_expected_version:0,p_rules:[],p_reason:'No current-year operations'});assert.ifError(policy.error);
  assert.ifError((await a.client.rpc('approve_financial_reporting_policy',{p_id:policy.data.id,p_expected_version:1})).error);
  const limited=await b.client.rpc('close_financial_year',{p_org:fiscalOrg,p_start:'2024-01-01',p_request:randomUUID(),p_reason:'Amount limit must be enforced'});assert.match(limited.error?.message??'',/FISCAL_CLOSE_DENIED/);
  const outcomes=await Promise.all([1,2].map(()=>a.client.rpc('close_financial_year',{p_org:fiscalOrg,p_start:'2024-01-01',p_request:request,p_reason:'Concurrent retry of one closing command'})));
  for(const outcome of outcomes)assert.ifError(outcome.error);
  assert.equal(outcomes[0].data.id,outcomes[1].data.id);
  const closes=await a.client.from('financial_year_closures').select('id').eq('organization_id',fiscalOrg);assert.ifError(closes.error);assert.equal(closes.data.length,1);
  const audit=await a.client.from('financial_fiscal_audit').select('id').eq('organization_id',fiscalOrg).eq('action','YEAR_CLOSE');assert.ifError(audit.error);assert.equal(audit.data.length,1);
 });
 await check('Organization settings persist January and July calendars, isolate tenants and preserve existing periods',async()=>{
  const january=randomUUID(),july=randomUUID();
  sql(`select set_config('request.jwt.claim.sub','${a.id}',false);
   insert into public.organizations(id,owner_user_id,name) values('${january}','${a.id}','ZZ fiscal settings January'),('${july}','${a.id}','ZZ fiscal settings July');
   insert into public.organization_members(organization_id,user_id,role,status) values('${january}','${a.id}','OWNER','ACTIVE'),('${july}','${a.id}','OWNER','ACTIVE'),('${july}','${b.id}','VIEWER','ACTIVE') on conflict(organization_id,user_id) do update set role=excluded.role,status='ACTIVE';
   insert into public.organization_member_permission_overrides(organization_id,user_id,permission,effect,created_by) values('${july}','${b.id}','financial_core.view','ALLOW','${a.id}'),('${july}','${b.id}','financial_core.create','DENY','${a.id}');
   select public.save_financial_chart_account('${january}','330001','3300','أرباح مبقاة تفصيلية','Detailed retained earnings','CREDIT',true,true,0,'Select posting leaf for January');
   select public.save_financial_chart_account('${july}','330001','3300','أرباح مبقاة تفصيلية','Detailed retained earnings','CREDIT',true,true,0,'Select posting leaf for July');`);
  for(const [organization,month,end] of [[january,1,'12-31'],[july,7,'06-30']]){
   await page.goto(app+'/en/settings/financial/fiscal-years?organization='+organization);
   const section=page.locator('.fiscal-calendar-settings');
   try{await section.getByLabel('Fiscal start month',{exact:true}).waitFor({timeout:12000})}catch{
    const diagnostic={url:page.url(),page:(await page.locator('body').innerText()).slice(0,900),api:await page.evaluate(async organization=>{
     const orgResponse=await fetch('/api/organizations',{cache:'no-store'}),orgs=await orgResponse.json().catch(()=>null);
     const fiscalResponse=await fetch('/api/financial-reporting/fiscal?'+new URLSearchParams({action:'management',organization}),{cache:'no-store'}),fiscal=await fiscalResponse.json().catch(()=>null);
     return{organizationsStatus:orgResponse.status,organizationVisible:Array.isArray(orgs)&&orgs.some(o=>o.id===organization),organizationsError:orgs?.error??null,fiscalStatus:fiscalResponse.status,fiscalError:fiscal?.error??null};
    },organization)};
    await page.screenshot({path:out+'/fiscal-settings-load-diagnostic.png',fullPage:true});throw Error('FISCAL_SETTINGS_NOT_VISIBLE '+JSON.stringify(diagnostic));
   }
   assert.equal(await section.getByLabel('Fiscal start month',{exact:true}).inputValue(),'1');
   await section.getByLabel('Fiscal start month',{exact:true}).selectOption(String(month));await section.getByLabel('Fiscal start day',{exact:true}).fill('1');await section.getByLabel('Retained earnings posting account',{exact:true}).selectOption('330001');await section.getByLabel('Setup or action reason',{exact:true}).fill('Configure fiscal calendar from organization settings');
   assert.match(await section.locator('[data-fiscal-period]').innerText(),new RegExp(end));
   const saved=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/financial-reporting/fiscal'&&r.request().method()==='POST');await section.getByRole('button',{name:'Save fiscal calendar',exact:true}).click();const response=await saved;assert.equal(response.status(),200,JSON.stringify(await response.json()));
   const stored=await a.client.rpc('financial_fiscal_context',{p_org:organization});assert.ifError(stored.error);assert.equal(stored.data.calendar.start_month,month);assert.equal(stored.data.calendar.retained_earnings_account,'330001');assert.ok(stored.data.period.end.endsWith(end));
   const historical=await a.client.rpc('financial_fiscal_context',{p_org:organization,p_as_of:'2026-11-04'});assert.ifError(historical.error);assert.equal(historical.data.period.start,month===1?'2026-01-01':'2026-07-01');assert.equal(historical.data.period.end,month===1?'2026-12-31':'2027-06-30');
   const opening=await a.client.rpc('financial_opening_workspace',{p_org:organization,p_fiscal_start:stored.data.period.start});assert.ifError(opening.error);assert.equal(opening.data.organizationId,organization);assert.equal(opening.data.fiscalStart,stored.data.period.start);
   const policy=await a.client.rpc('financial_reporting_policy_workspace',{p_org:organization,p_fiscal_start:stored.data.period.start});assert.ifError(policy.error);assert.equal(policy.data.fiscalStart,stored.data.period.start);
   const initialRecordCounts=sql("select jsonb_build_array((select count(*) from public.financial_year_closures),(select count(*) from public.financial_opening_workspaces),(select count(*) from public.financial_fiscal_audit))");
   const years=page.locator('[data-fiscal-year]');assert.equal(await years.count(),5);assert.match(await page.locator('[data-fiscal-year="'+(month===1?'2026-01-01':'2026-07-01')+'"]').innerText(),new RegExp(end));
   await page.getByRole('button',{name:'Show more years',exact:true}).click();assert.equal(await years.count(),9);assert.equal(sql("select jsonb_build_array((select count(*) from public.financial_year_closures),(select count(*) from public.financial_opening_workspaces),(select count(*) from public.financial_fiscal_audit))"),initialRecordCounts);
   await page.reload();await section.getByLabel('Fiscal start month',{exact:true}).waitFor();assert.equal(await section.getByLabel('Fiscal start month',{exact:true}).inputValue(),String(month));assert.match(await section.locator('[data-fiscal-period]').innerText(),new RegExp(end));
   await page.screenshot({path:out+'/fiscal-settings-'+month+'.png',fullPage:true});
  }
  const picker=page.locator('#corp-organization-controls').getByRole('combobox',{name:'Selected organization',exact:true});await page.getByLabel('Setup or action reason',{exact:true}).fill('Unsaved calendar note');const discard=page.waitForEvent('dialog');const rejectedSwitch=picker.selectOption(january);const prompt=await discard;assert.equal(prompt.message(),'Discard unsaved changes?');await prompt.dismiss();await rejectedSwitch;assert.equal(await picker.inputValue(),july);page.once('dialog',dialog=>dialog.accept());await picker.selectOption(january);await page.waitForFunction(()=>document.querySelector('.fiscal-calendar-settings select')?.value==='1');assert.match(await page.locator('[data-fiscal-period]').innerText(),/12-31/);
  const period=await a.client.rpc('financial_fiscal_context',{p_org:july});assert.ifError(period.error);
  const workspace=await a.client.rpc('financial_opening_workspace',{p_org:july,p_fiscal_start:period.data.period.start});assert.ifError(workspace.error);
  const draft=await a.client.rpc('save_financial_opening',{p_org:july,p_fiscal_start:period.data.period.start,p_expected_version:0,p_source_revision:workspace.data.source.revision,p_entries:{},p_reason:'Preserved accounting period must not move with calendar editing'});assert.ifError(draft.error);
  await page.goto(app+'/en/settings/financial/fiscal-years?organization='+july);const section=page.locator('.fiscal-calendar-settings');await section.getByLabel('Fiscal start month',{exact:true}).waitFor();assert.equal(await section.getByLabel('Fiscal start month',{exact:true}).isDisabled(),true);assert.equal(await section.getByRole('button',{name:'Save fiscal calendar',exact:true}).count(),0);
  const lockedChange=await page.request.post(app+'/api/financial-reporting/fiscal',{headers:{Origin:app},data:{action:'calendar',organization:july,month:1,day:1,retainedAccount:'3300',expectedVersion:1,reason:'Changing a used calendar must require accounting correction'}});assert.equal(lockedChange.status(),409);assert.equal((await lockedChange.json()).error,'FISCAL_CALENDAR_IN_USE');
  const preserved=await a.client.from('financial_opening_workspaces').select('*').eq('id',draft.data.id).single();assert.ifError(preserved.error);assert.deepEqual(preserved.data,draft.data);
  const after=await a.client.rpc('financial_fiscal_context',{p_org:july});assert.ifError(after.error);assert.deepEqual(after.data.calendar,period.data.calendar);
  const foreign=await b.client.rpc('financial_fiscal_context',{p_org:january});assert.match(foreign.error?.message??'',/FISCAL_ACCESS_DENIED/);
  const readonlyCookies=[];const readonlySsr=createServerClient(url,status.ANON_KEY,{cookies:{getAll:()=>readonlyCookies,setAll:cs=>{for(const c of cs){const index=readonlyCookies.findIndex(v=>v.name===c.name);if(index>=0)readonlyCookies.splice(index,1);readonlyCookies.push(c)}}}});assert.ifError((await readonlySsr.auth.signInWithPassword({email:b.email,password:b.password})).error);
  const readonlyContext=await browser.newContext();try{
   await readonlyContext.addCookies(readonlyCookies.map(c=>({name:c.name,value:c.value,domain:'localhost',path:'/',httpOnly:false,secure:false,sameSite:'Lax'})));const readonlyPage=await readonlyContext.newPage();await readonlyPage.goto(app+'/en/settings/financial/fiscal-years?organization='+july);const readonlySection=readonlyPage.locator('.fiscal-calendar-settings');await readonlySection.getByLabel('Fiscal start month',{exact:true}).waitFor();assert.equal(await readonlySection.getByLabel('Fiscal start month',{exact:true}).isDisabled(),true);assert.equal(await readonlySection.getByRole('button',{name:'Save fiscal calendar',exact:true}).count(),0);
   const forbidden=await readonlyPage.request.post(app+'/api/financial-reporting/fiscal',{headers:{Origin:app},data:{action:'calendar',organization:july,month:1,day:1,retainedAccount:'3300',expectedVersion:1,reason:'A view-only user cannot change fiscal settings'}});assert.equal(forbidden.status(),403);assert.equal((await forbidden.json()).error,'FISCAL_WRITE_DENIED');
   await readonlyPage.goto(app+'/en/settings/financial/fiscal-years?organization='+january);await readonlyPage.getByRole('alert').waitFor();assert.equal(await readonlyPage.locator('.fiscal-calendar-settings').count(),0);
  }finally{await readonlyContext.close()}
  await page.setViewportSize({width:390,height:844});await page.goto(app+'/ar/settings/financial/fiscal-years?organization='+july);await page.locator('.fiscal-calendar-settings').getByLabel('شهر بداية السنة',{exact:true}).waitFor();assert.equal(await page.locator('.fiscal-calendar-settings').getByLabel('شهر بداية السنة',{exact:true}).inputValue(),'7');await page.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth,null,{timeout:5000});await page.screenshot({path:out+'/fiscal-settings-july-ar-mobile.png',fullPage:true});
 });
 await check('Liquidity alone offers NEW zero versus a dated existing balance in both languages and on mobile',async()=>{
  for(const [lang,width] of [['en',1672],['ar',390]]){
   await page.setViewportSize({width,height:width===390?844:941});await page.goto(app+'/'+lang+'/liquidity?tab=position');
   await page.getByRole('button',{name:lang==='ar'?'إضافة حساب':'Add account',exact:true}).first().click();
   const modal=page.locator('.liq-modal');const method=modal.getByLabel(lang==='ar'?'طريقة فتح الحساب':'Account opening method',{exact:true});
   assert.equal(await method.inputValue(),'NEW');const balance=modal.getByLabel(lang==='ar'?'الرصيد السابق':'Existing balance',{exact:true});assert.equal(await balance.isDisabled(),true);assert.equal(await balance.inputValue(),'0');
   await method.selectOption('OPENING');assert.equal(await balance.isEnabled(),true);await balance.fill('500');
   await page.screenshot({path:out+'/liquidity-opening-'+lang+'-'+width+'.png',fullPage:true});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await method.selectOption('NEW');assert.equal(await balance.inputValue(),'0');assert.equal(await balance.isDisabled(),true);
  }
 });
 await check('Real browser bank rename, deactivate/reactivate and stable chart link preserve balances without postings',async()=>{
  report.bankResponses=[];page.on('response',response=>{const path=new URL(response.url()).pathname;if(path.startsWith('/api/liquidity')||path==='/api/financial-reporting/fiscal')report.bankResponses.push({path,status:response.status(),method:response.request().method()})});
  const bankOrg=randomUUID();sql(`select set_config('request.jwt.claim.sub','${a.id}',false);insert into public.organizations(id,owner_user_id,name) values('${bankOrg}','${a.id}','QA browser bank sync');insert into public.organization_members(organization_id,user_id,role,status) values('${bankOrg}','${a.id}','OWNER','ACTIVE') on conflict(organization_id,user_id) do update set role='OWNER',status='ACTIVE';`);
  sql(`insert into public.liquidity_accounts(organization_id,name,account_type,currency,current_balance,current_balance_base,created_by,metadata) values('${bankOrg}','QA existing bank 1','BANK','SAR',2500000,2500000,'${a.id}','{}'),('${bankOrg}','QA existing bank 2','BANK','SAR',400000,400000,'${a.id}','{}'),('${bankOrg}','QA existing bank 3','BANK','SAR',250000,250000,'${a.id}','{}');`);
  console.log('BANK_SYNC stage: legacy registers seeded');await page.setViewportSize({width:1672,height:941});await page.goto(app+'/en/liquidity?tab=position&organization='+bankOrg);const reconciled=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/financial-reporting/fiscal'&&r.request().method()==='POST');await page.getByRole('button',{name:'Link chart · 3',exact:true}).click();console.log('BANK_SYNC stage: link clicked');const reconciledResponse=await reconciled;console.log('BANK_SYNC stage: response headers received');assert.equal(reconciledResponse.status(),200);
  await page.getByRole('button',{name:/^Link chart/}).waitFor({state:'detached'});console.log('BANK_SYNC stage: link command returned');const three=JSON.parse(sql(`select jsonb_build_object('links',count(*),'unique',count(distinct l.chart_account_id),'under1000',count(*) filter(where c.reporting_code='1000'),'balance',sum(b.current_balance_base)) from public.financial_cash_account_links l join public.liquidity_accounts b on b.id=l.account_id join public.financial_chart_custom_accounts c on c.id=l.chart_account_id where l.organization_id='${bankOrg}'`));assert.deepEqual(three,{links:3,unique:3,under1000:3,balance:3150000});
  console.log('BANK_SYNC stage: legacy link assertions passed');const calendar=await a.client.rpc('save_financial_fiscal_calendar',{p_org:bankOrg,p_month:1,p_day:1,p_retained:'3300',p_expected_version:0,p_reason:'Browser opening correction calendar'});assert.ifError(calendar.error);
  const opened=await a.client.rpc('open_financial_account',{p_payload:{request_id:randomUUID(),scope:'ORGANIZATION',organization_id:bankOrg,entity_id:null,type:'BANK',name:'QA browser bank',currency:'SAR',balance_mode:'NEW',opening_balance:0,opening_date:'2026-01-01',fx_rate:1,notes:'Browser fixture only'}});assert.ifError(opened.error);const bankId=opened.data.id;console.log('BANK_SYNC stage: new bank opened');
  const linked=()=>JSON.parse(sql(`select jsonb_build_object('bank',to_jsonb(b),'link',to_jsonb(l),'chart',to_jsonb(c),'events',(select count(*) from public.financial_events where organization_id=b.organization_id),'settlements',(select count(*) from public.liquidity_settlements where organization_id=b.organization_id)) from public.liquidity_accounts b join public.financial_cash_account_links l on l.account_id=b.id join public.financial_chart_custom_accounts c on c.id=l.chart_account_id where b.id='${bankId}'`));
  const before=linked();await page.setViewportSize({width:1672,height:941});await page.goto(app+'/en/liquidity?tab=position&organization='+bankOrg);
  await page.getByRole('button',{name:'Edit account: QA browser bank',exact:true}).click();let form=page.getByRole('form',{name:'Edit bank account',exact:true});await form.getByLabel('Account name',{exact:true}).fill('QA browser bank renamed');await form.getByLabel('Change reason',{exact:true}).fill('Rename the display label without moving any money');
  async function saveMetadata(){const saved=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/liquidity/accounts/'+bankId&&r.request().method()==='PATCH');await form.getByRole('button',{name:'Save and synchronize',exact:true}).click();const response=await saved;assert.equal(response.status(),200);await page.getByRole('form',{name:'Edit bank account',exact:true}).waitFor({state:'detached'});}
  await saveMetadata();console.log('BANK_SYNC stage: rename saved');let after=linked();assert.equal(after.chart.name_ar,'QA browser bank renamed');assert.equal(after.chart.name_en,'QA browser bank renamed');assert.equal(after.link.chart_account_id,before.link.chart_account_id);assert.equal(after.bank.id,before.bank.id);assert.equal(after.bank.current_balance_base,before.bank.current_balance_base);
  await page.getByRole('button',{name:'Edit account: QA browser bank renamed',exact:true}).click();form=page.getByRole('form',{name:'Edit bank account',exact:true});await form.getByLabel('Active status',{exact:true}).selectOption('false');await form.getByLabel('Change reason',{exact:true}).fill('Deactivate the unused zero bank');await saveMetadata();await page.getByRole('heading',{name:'Inactive accounts',exact:true}).waitFor();after=linked();assert.equal(after.bank.active,false);assert.equal(after.chart.is_active,false);
  await page.getByRole('button',{name:'Edit account: QA browser bank renamed',exact:true}).click();form=page.getByRole('form',{name:'Edit bank account',exact:true});await form.getByLabel('Active status',{exact:true}).selectOption('true');await form.getByLabel('Change reason',{exact:true}).fill('Reactivate the same stable bank');await saveMetadata();after=linked();assert.equal(after.bank.active,true);assert.equal(after.chart.is_active,true);assert.equal(after.link.chart_account_id,before.link.chart_account_id);assert.equal(after.events,0);assert.equal(after.settlements,0);
  const blocked=await page.request.patch(app+'/api/liquidity/accounts/'+bankId,{headers:{Origin:app},data:{organization:other,name:'Foreign rename',active:true,expectedName:'QA browser bank renamed',expectedActive:true,reason:'Cross-scope attempt must fail'}});assert.equal(blocked.status(),403);assert.equal(linked().chart.name_ar,'QA browser bank renamed');
  await page.getByRole('button',{name:'Account details and statement: QA browser bank renamed',exact:true}).click();let details=page.getByRole('dialog',{name:'Bank account details and statement',exact:true});await details.getByRole('button',{name:'Correct opening balance',exact:true}).click();await details.getByLabel('Corrected opening balance',{exact:true}).fill('123');await details.getByLabel('Correction reason',{exact:true}).fill('Match original bank opening confirmation');const corrected=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/liquidity/accounts/'+bankId&&r.request().method()==='POST');await details.getByRole('button',{name:'Save correction',exact:true}).click();const correctedResponse=await corrected;assert.equal(correctedResponse.status(),200);await details.getByRole('button',{name:'Correct opening balance',exact:true}).waitFor();after=linked();assert.equal(after.bank.current_balance,123);assert.equal(after.events,0);assert.equal(after.settlements,0);await details.getByRole('button',{name:'Close',exact:true}).click();
  sql(`select set_config('request.jwt.claim.sub','${a.id}',false);insert into public.liquidity_flows(organization_id,account_id,direction,flow_type,title,due_date,amount,currency,base_amount,status,source,created_by) values('${bankOrg}','${bankId}','OUTFLOW','OTHER','QA statement original source','2026-10-15',23,'SAR',23,'ACTUAL','MANUAL','${a.id}');update public.liquidity_accounts set current_balance=100,current_balance_base=100 where id='${bankId}';insert into public.liquidity_flows(organization_id,account_id,direction,flow_type,title,due_date,amount,currency,base_amount,status,source,created_by) select '${bankOrg}','${bankId}','INFLOW','OTHER','QA forecast pagination '||n,'2026-01-02',1,'SAR',1,'EXPECTED','MANUAL','${a.id}' from generate_series(1,1500)n;`);
  await page.goto(app+'/en/liquidity?tab=position&organization='+bankOrg);await page.getByRole('button',{name:'Account details and statement: QA browser bank renamed',exact:true}).click();details=page.getByRole('dialog',{name:'Bank account details and statement',exact:true});await details.getByText('QA statement original source',{exact:true}).waitFor();await details.locator('tbody tr').filter({hasText:'QA statement original source'}).locator('summary').click();await details.getByRole('button',{name:'Open source and edit',exact:true}).click();const original=page.getByRole('form',{name:'Edit actual movement description',exact:true});await original.getByLabel('Movement description',{exact:true}).fill('QA corrected original source');await original.getByLabel('Correction reason',{exact:true}).fill('Correct description against original statement');const described=page.waitForResponse(r=>r.url().includes('/api/liquidity/flows/')&&r.request().method()==='PATCH');await original.getByRole('button',{name:'Save description',exact:true}).click();const describedResponse=await described;assert.equal(describedResponse.status(),200);assert.equal(linked().bank.current_balance,100);assert.equal(linked().events,0);assert.equal(linked().settlements,0);await original.getByRole('button',{name:'Close',exact:true}).click();
  await page.setViewportSize({width:390,height:844});await page.goto(app+'/ar/liquidity?tab=position&organization='+bankOrg);await page.getByRole('button',{name:'تفاصيل وكشف الحساب: QA browser bank renamed',exact:true}).click();const statementMobile=page.getByRole('dialog',{name:'تفاصيل الحساب البنكي وكشفه',exact:true});await statementMobile.getByText('QA corrected original source',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:out+'/bank-statement-ar-mobile.png',fullPage:true});await statementMobile.getByRole('button',{name:'إغلاق',exact:true}).click();
  await page.setViewportSize({width:390,height:844});await page.goto(app+'/ar/liquidity?tab=position&organization='+bankOrg);await page.getByRole('button',{name:'تعديل الحساب: QA browser bank renamed',exact:true}).click();const arabicForm=page.getByRole('form',{name:'تعديل الحساب البنكي',exact:true});await arabicForm.getByLabel('اسم الحساب',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:out+'/bank-metadata-sync-ar-mobile.png',fullPage:true});await arabicForm.getByRole('button',{name:'إغلاق',exact:true}).click();
 });
 await check('Posted statement action opens the exact authorized financial voucher',async()=>{
  const posted=JSON.parse(sql(`select to_jsonb(x) from(select s.organization_id org,s.financial_event_id event,a.name bank from public.liquidity_settlements s join public.liquidity_accounts a on a.id=s.account_id join public.organization_members m on m.organization_id=s.organization_id and m.user_id='${a.id}' and m.status='ACTIVE' and m.role='OWNER' where s.status='POSTED' and s.financial_event_id is not null order by s.id limit 1)x`));assert.ok(posted);
  await page.setViewportSize({width:1672,height:941});await page.goto(app+'/en/liquidity?tab=position&organization='+posted.org);await page.getByRole('button',{name:'Account details and statement: '+posted.bank,exact:true}).click();const details=page.getByRole('dialog',{name:'Bank account details and statement',exact:true}),link=details.locator('a[href*="/cash-vouchers/'+posted.event+'"]');await link.waitFor({state:'attached'});await link.locator('..').locator('summary').click();await link.click();await page.locator('[data-cash-voucher="'+posted.event+'"]').waitFor();await page.getByRole('heading',{name:'Original cash movement voucher',exact:true}).waitFor();
 });
 await check('All native settings sections retain real organization scope across desktop/mobile AR/EN',async()=>{
  // Earlier revocation assertions intentionally disabled this synthetic member.
  // Restore only that disposable fixture before testing authorized settings.
  sql(`update public.organization_members set status='ACTIVE' where organization_id='${org}' and user_id='${a.id}'`);
  for(const resource of ['users','roles','permissions']){
   const response=await page.request.get(app+'/api/organizations/'+resource+'?organization_id='+org);
   assert.equal(response.status(),200,'Authorized team '+resource+': '+await response.text());
  }
  const readinessResponse=await page.request.get(app+'/api/financial-reporting/setup-readiness?'+new URLSearchParams({organization:org,mode:'EXISTING'}));
  assert.equal(readinessResponse.status(),200);assert.equal((await readinessResponse.json()).organizationId,org);
  const sections=[['settings','.organization-details-workspace'],['settings/regulatory','[data-regulatory-workspace]'],['settings/financial','[data-financial-settings]'],['settings/team','.settings-native-team'],['settings/system','[data-system-preferences]'],['billing','.yb-billing']];
  for(const locale of ['ar','en'])for(const [route,selector] of sections){
   await page.setViewportSize({width:1490,height:1050});
   await page.goto(app+'/'+locale+'/'+route+'?organization='+org);
   await page.locator(selector).waitFor();
   assert.equal(await page.locator('iframe').count(),0,'Native settings cannot contain framed app screens');
   if(route==='settings/financial')await page.locator('.fiscal-calendar-settings').waitFor();
   if(route==='settings/team'){
    await page.getByText(a.email,{exact:true}).first().waitFor();
    if(locale==='en'){
     const teamNav=page.getByRole('navigation',{name:'User and role management',exact:true});
     assert.equal(await teamNav.getByRole('button').count(),3);
     await teamNav.getByRole('button',{name:'Roles & permissions',exact:true}).click();
     await page.getByRole('heading',{name:'Roles & permissions',exact:true,level:2}).waitFor();
     await teamNav.getByRole('button',{name:'Members',exact:true}).click();
     const invite=page.locator('.team-invite-card');await invite.getByLabel('Email',{exact:true}).fill('native-settings-acceptance@settings.invalid');
     const created=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/organizations/users'&&r.request().method()==='POST');
     await invite.getByRole('button',{name:'Create invite',exact:true}).click();const response=await created;
     assert.equal(response.status(),201,await response.text());
     await invite.getByLabel('Invite link',{exact:true}).waitFor();
     await page.locator('.settings-team-invitations').getByText('native-settings-acceptance@settings.invalid',{exact:true}).waitFor();
     const stored=await page.request.get(app+'/api/organizations/users?organization_id='+org);
     assert.equal(stored.status(),200);assert.ok((await stored.json()).invitations.some(i=>i.email==='native-settings-acceptance@settings.invalid'));
    }
   }
   assert.equal(new URL(page.url()).searchParams.get('organization'),org);
   for(const width of [1490,390]){
    await page.setViewportSize({width,height:1050});
    await page.waitForFunction(()=>{const w=document.querySelector('.corp-workspace');return !w||Math.abs(w.getBoundingClientRect().width-innerWidth)<2||innerWidth>1000;});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),locale+' '+route+' native layout overflow');
    await page.evaluate(()=>window.scrollTo(0,0));
    await page.screenshot({path:out+'/native-'+route.replaceAll('/','-')+'-'+locale+'-'+width+'.png',fullPage:true});
   }
  }
 });
 assert.deepEqual(errors,[]);report.browserExceptions=errors;await context.close();
}catch(error){report.failure={message:error.message,stack:error.stack};try{await page?.screenshot({path:out+'/failure.png',fullPage:true,timeout:5000})}catch{}throw error}finally{await Promise.race([browser?.close(),new Promise(r=>setTimeout(r,5000))]);server?.kill();await writeFile(out+'/results.json',JSON.stringify(report,null,2)+'\n')}
// Exit only after assertions, evidence writes and cleanup; background SDK handles must not keep CI alive.
process.exit(0);
