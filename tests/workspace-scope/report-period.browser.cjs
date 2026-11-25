// Actual report/opening components in Chromium with synthetic, intercepted reads.
// No Next server, credentials, Auth, database access or hosted requests.
const assert=require('node:assert/strict');
const {createServer}=require('node:http');
const {mkdtemp,mkdir,readFile,writeFile,rm}=require('node:fs/promises');
const {tmpdir}=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {build}=require('esbuild');
const A='10000000-0000-4000-8000-000000000001',B='10000000-0000-4000-8000-000000000002';
const root=process.cwd(),out=process.env.REPORT_PERIOD_ARTIFACTS||path.join(root,'tests/workspace-scope/artifacts/report-period');
const component=process.env.REPORT_PERIOD_COMPONENT||path.join(root,'components/financial-reports/FinancialStatementSource.tsx');
const openingComponent=process.env.REPORT_PERIOD_OPENING_COMPONENT||path.join(root,'components/financial-reports/LiveOpeningBalances.tsx');
const row=(id,period)=>({organizationId:id,name:id===A?'Synthetic Alpha':'Synthetic Beta',currency:'SAR',parentOrganizationId:null,fiscalStart:period?'2026-01-01':'',fiscalEnd:period?'2026-12-31':'',dimensionalCenters:false});
const checks=[],pageErrors=[],writes=[],unexpected=[];
let directory,server,browser,page,origin,normalize;
let contextRows=[row(A,false),row(B,true)],contextError=false,statementError='',holdNext=false,pending=null;
let openingError='',holdOpening=false,pendingOpening=null,holdOpeningContext=false,pendingOpeningContext=null;
const reads=[],openingReads=[];
async function check(name,run){
 if(process.env.REPORT_PERIOD_CHECK&&!name.includes(process.env.REPORT_PERIOD_CHECK))return;
 console.log('CHECK '+name);
 try{await run();checks.push({name,status:'passed'});console.log('PASS '+name);}
 catch(error){checks.push({name,status:'failed',error:String(error)});throw error;}
}
const ui=()=>({setup:page.locator('[data-statement-prerequisite="SETUP"]'),dates:page.locator('[data-statement-prerequisite="DATES"]'),ready:page.locator('[data-statement-ready="overview"]'),error:page.locator('.fs-source-error'),loading:page.locator('.fs-source-loading'),export:page.locator('.fs-export-control > button')});
const statementReads=()=>reads.filter(request=>request.action==='statements');
async function settle(){await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))}
async function open(locale='en',organization=A,width=1440,screen='financial-reports',fiscalStart=''){
 if(page)await page.close();
 page=await browser.newPage({viewport:{width,height:1000}});page.setDefaultTimeout(12000);
 page.on('pageerror',error=>pageErrors.push(error.message));
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.origin!==origin)return route.abort('blockedbyclient');
  if(!url.pathname.startsWith('/api/'))return route.continue();
  if(request.method()!=='GET'){writes.push(request.method()+' '+url.pathname);return route.abort('blockedbyclient');}
  if(url.pathname==='/api/financial-reporting/fiscal'&&url.searchParams.get('action')==='sources')return route.fulfill({status:200,json:[]});
  if(url.pathname==='/api/financial-reporting/openings'){
   if(screen!=='opening-balances')return route.fulfill({status:404,json:{error:'OPENING_NOT_FOUND'}});
   const query=Object.fromEntries(url.searchParams);openingReads.push(query);
   if(query.action==='context'){
    const complete=()=>route.fulfill(contextError?{status:503,json:{error:'OPENING_UNAVAILABLE'}}:{status:200,json:contextRows.map(o=>({id:o.organizationId,name:o.name,base_currency:o.currency,currentFiscalStart:o.fiscalStart||null,canEditCenterOpenings:false}))});
    if(holdOpeningContext){holdOpeningContext=false;pendingOpeningContext=complete;return;}return complete();
   }
   const complete=()=>route.fulfill(openingError?{status:503,json:{error:openingError}}:{status:200,json:openingFixture(query)});
   if(holdOpening){holdOpening=false;pendingOpening=complete;return;}
   return complete();
  }
  if(url.pathname!=='/api/financial-reporting/live-statements'){unexpected.push(url.pathname);return route.fulfill({status:500,json:{error:'UNEXPECTED_READ'}});}
  const query=Object.fromEntries(url.searchParams);reads.push(query);
  if(query.action==='context')return route.fulfill(contextError?{status:503,json:{error:'REPORTING_UNAVAILABLE'}}:{status:200,json:contextRows});
  if(query.action==='branches')return route.fulfill({status:200,json:{organizationId:query.organization,branches:[]}});
  if(query.action!=='statements'){unexpected.push(query.action);return route.fulfill({status:500,json:{error:'UNEXPECTED_ACTION'}});}
  const complete=()=>{try{return route.fulfill(statementError?{status:503,json:{error:statementError}}:{status:200,json:normalize(query)})}catch(error){unexpected.push('Statement fixture: '+String(error));return route.fulfill({status:500,json:{error:'INVALID_SYNTHETIC_FIXTURE'}})}};
  if(holdNext){holdNext=false;pending=complete;return;}
  return complete();
 });
 await page.goto(origin+`/${locale}/${screen}?scope=ORGANIZATION&organization=${organization}&level=COMPANY`+(fiscalStart?'&fiscalStart='+fiscalStart:''));
 await page.locator(screen==='financial-reports'?'.fs-page-header':'.fs-root').waitFor();
}
function openingFixture(query){return {organizationId:query.organization,fiscalStart:query.fiscalStart,cutoff:'2025-12-31',currency:'SAR',chart:[{id:'synthetic-receivable',code:'1201',ar:'العملاء',en:'Customers',kind:'ASSET',cash:false,presentation:'CURRENT_ASSETS'}],source:{revision:'a'.repeat(32),financialRevision:'b'.repeat(32),rows:[{id:'synthetic-customer',tab:'customers',accountCode:'1201',accountAr:'العملاء',accountEn:'Customers',ar:'عميل تجريبي',en:'Synthetic customer',normal:'DEBIT',sourceIssue:null,vouchers:[{canonicalId:'synthetic-opening',number:'SYNTHETIC-OPENING',debit:'250.0000',credit:'0.0000'}]}]},workspace:null,canSave:false,canApprove:false};}
async function requireDisabled(){assert.equal(await ui().export.isEnabled(),false);assert.equal(await ui().ready.count(),0);}
async function requireReady(){await ui().ready.waitFor();assert.equal(await ui().export.isEnabled(),true);assert.equal(await page.locator('[data-statement-prerequisite]').count(),0);assert.equal(await ui().error.count(),0);}
(async()=>{
 await mkdir(out,{recursive:true});directory=await mkdtemp(path.join(tmpdir(),'yaqeen-report-period-'));
 const navigation="export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);export const useParams=()=>({locale:location.pathname.split('/')[1]});export const useRouter=()=>({push:()=>{},replace:()=>{},refresh:()=>{}});";
 const link="import React from 'react';export default function Link({href,children,prefetch,scroll,replace,...props}){return <a {...props} href={href}>{children}</a>}";
 await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import Source from ${JSON.stringify(component)};import Opening from ${JSON.stringify(openingComponent)};const q=new URLSearchParams(location.search),root=createRoot(document.getElementById('root')),locale=location.pathname.startsWith('/en/')?'en':'ar';window.renderOpening=props=>root.render(<Opening locale={locale} preferredOrg={q.get('organization')||''} preferredFiscalStart={q.get('fiscalStart')||''} {...props}/>);if(location.pathname.endsWith('/opening-balances'))window.renderOpening({});else root.render(<Source live initialView="overview" initialEnglish={locale==='en'} preferredOrg={q.get('organization')||''}/>);`,loader:'tsx',resolveDir:root},bundle:true,write:true,outfile:path.join(directory,'fixture.js'),jsx:'automatic',define:{'process.env':'{}','process.env.NODE_ENV':'"production"'},plugins:[{name:'isolated-framework-boundary',setup(builder){builder.onResolve({filter:/^next\/(navigation|link)$/},args=>({path:args.path,namespace:'fixture'}));builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path.endsWith('navigation')?navigation:link,loader:'tsx',resolveDir:root}));builder.onResolve({filter:/.*/},args=>args.kind==='url-token'?{path:args.path,external:true}:undefined);}}]});
 await build({entryPoints:[path.join(root,'lib/financial-statement-source.ts')],bundle:true,platform:'node',format:'cjs',outfile:path.join(directory,'normalize.cjs')});
 const {normalizeStatementSource}=require(path.join(directory,'normalize.cjs'));
 const raw=JSON.parse(await readFile(path.join(root,'tests/financial-reporting/statement-snapshot.json'),'utf8'));
 // Keep the existing fixture's amounts and posting rules; provide synthetic UUID
 // identities accepted by the live adapter's structural provenance validation.
 const syntheticId=(prefix,index)=>prefix+'-0000-4000-8000-'+String(index+1).padStart(12,'0');
 const classifications=new Map();for(const rule of raw.policy.rules){if(!classifications.has(rule.classificationId))classifications.set(rule.classificationId,syntheticId('20000000',classifications.size)+':BASE');rule.classificationId=classifications.get(rule.classificationId);}
 let lineIndex=0;raw.events.forEach((event,index)=>{event.id=syntheticId('30000000',index);event.lines.forEach(line=>{line.id=syntheticId('40000000',lineIndex++)+':BASE';line.classificationId=classifications.get(line.classificationId);});});
 normalize=query=>{const fixture=JSON.parse(JSON.stringify(raw).split(raw.organizationId).join(query.organization));fixture.origin='LIVE_CANONICAL_EVENTS';fixture.from=query.from;fixture.to=query.to;return normalizeStatementSource(fixture,{organization:query.organization,from:query.from,to:query.to})};
 const html='<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><style>body{margin:0;font-family:Arial,Tahoma,sans-serif}#corp-organization-controls{display:flex;gap:12px;padding:12px;flex-wrap:wrap}.fs-surface{max-width:1160px;margin:auto}.fs-source-period-required p{line-height:1.7}</style></head><body><div id="corp-organization-controls"></div><div id="root"></div><script src="/fixture.js"></script></body></html>';
 server=createServer(async(req,res)=>{const pathname=new URL(req.url,'http://localhost').pathname;if(/\/(financial-reports|opening-balances)$/.test(pathname)){res.setHeader('Content-Type','text/html');res.end(html);return;}if(!['/fixture.js','/fixture.css'].includes(pathname)){res.statusCode=404;res.end();return;}res.setHeader('Content-Type',pathname.endsWith('.js')?'text/javascript':'text/css');res.end(await readFile(path.join(directory,pathname.slice(1))));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
 const runner=await import(pathToFileURL(require.resolve(process.env.SCOPE_BROWSER_MODULE||process.env.SCOPE_UI_BROWSER_MODULE||'playwright-core')).href);const {chromium}=runner.chromium?runner:runner.default;
 const launch={headless:true};if(process.env.SCOPE_UI_CHROMIUM_MODULE){const binary=(await import(pathToFileURL(process.env.SCOPE_UI_CHROMIUM_MODULE).href)).default;launch.executablePath=await binary.executablePath();launch.args=binary.args;}
 browser=await chromium.launch(launch);
 await check('Missing fiscal setup is explicit and company switching recovers without invented dates',async()=>{
  await open();await ui().setup.waitFor();await requireDisabled();
  assert.equal(await page.getByLabel('From date',{exact:true}).inputValue(),'');assert.equal(await page.getByLabel('To date',{exact:true}).inputValue(),'');
  assert.equal(statementReads().length,0);assert.equal(await ui().loading.count(),0);assert.equal(await ui().error.count(),0);
  const href=await ui().setup.getByRole('link').getAttribute('href'),target=new URL(href,origin);
  assert.equal(target.pathname,'/en/settings/financial/fiscal-years');assert.equal(target.searchParams.get('organization'),A);assert.equal(target.searchParams.get('scope'),'ORGANIZATION');assert.equal(target.searchParams.get('level'),'COMPANY');
  await page.screenshot({path:path.join(out,'missing-period-en.png')});
  await page.getByRole('combobox',{name:'Organization',exact:true}).selectOption(B);await requireReady();assert.equal(statementReads().at(-1).organization,B);
  const before=statementReads().length;await page.getByRole('combobox',{name:'Organization',exact:true}).selectOption(A);await ui().setup.waitFor();await requireDisabled();assert.equal(statementReads().length,before);
 });
 await check('Arabic mobile setup prerequisite recovers when an authorized period becomes available',async()=>{
  await open('ar',A,390);await ui().setup.waitFor();assert.match(await ui().setup.innerText(),/لا توجد فترة مالية متاحة/);await requireDisabled();
  assert.match(await ui().setup.getByRole('link').getAttribute('href'),/^\/ar\/settings\/financial\/fiscal-years\?/);
  await page.screenshot({path:path.join(out,'missing-period-ar-mobile.png')});
  contextRows=[row(A,true),row(B,true)];await page.getByRole('button',{name:'تحديث',exact:true}).click();await requireReady();
  assert.equal(await page.getByLabel('من تاريخ',{exact:true}).inputValue(),'2026-01-01');assert.equal(statementReads().at(-1).organization,A);
 });
 await check('Clearing dates cancels a pending report and asks for input without suggesting missing setup',async()=>{
  await open('en',A);await requireReady();holdNext=true;pending=null;
  await page.getByLabel('From date',{exact:true}).fill('2026-02-01');
  for(let attempt=0;attempt<100&&!pending;attempt++)await new Promise(resolve=>setTimeout(resolve,20));assert.ok(pending);
  await page.getByLabel('From date',{exact:true}).fill('');await ui().dates.waitFor();await requireDisabled();
  assert.equal(await ui().setup.count(),0);assert.equal(await ui().dates.getByRole('link').count(),0);assert.equal(await ui().loading.count(),0);
  await pending();await settle();await requireDisabled();await ui().dates.waitFor();
  await page.getByLabel('From date',{exact:true}).fill('2026-01-01');await requireReady();
 });
 await check('Source errors remain visible and a successful retry restores the real fixture report',async()=>{
  statementError='REPORTING_APPROVED_POLICY_REQUIRED';await open('en',B);await ui().error.waitFor();
  assert.match(await ui().error.innerText(),/posting rules/);assert.equal(await page.locator('[data-statement-prerequisite]').count(),0);await requireDisabled();
  statementError='';await page.getByRole('button',{name:'Refresh',exact:true}).click();await requireReady();
 });
 await check('Context failures remain errors and inaccessible contexts retain the explicit no-source state',async()=>{
  contextError=true;await open('en',A);await ui().error.waitFor();await requireDisabled();assert.equal(await page.locator('[data-statement-prerequisite]').count(),0);
  contextError=false;contextRows=[];await open('en',A);await page.getByRole('heading',{name:'No authorized statement sources',exact:true}).waitFor();await requireDisabled();assert.equal(await page.locator('[data-statement-prerequisite]').count(),0);
 });
 await check('Opening balances with no fiscal calendar show a bilingual scoped prerequisite and no invented workspace',async()=>{
  contextRows=[row(A,false),row(B,true)];contextError=false;
  for(const locale of ['en','ar']){
   const before=openingReads.filter(q=>!q.action).length;await open(locale,A,locale==='ar'?390:1440,'opening-balances');
   const setup=page.locator('[data-opening-prerequisite="SETUP"]');await setup.waitFor();
   await page.getByRole('heading',{name:locale==='en'?'Opening balances':'الأرصدة الافتتاحية',exact:true}).waitFor();
   const target=new URL(await setup.getByRole('link').getAttribute('href'),origin);assert.equal(target.pathname,`/${locale}/settings/financial/fiscal-years`);assert.equal(target.searchParams.get('organization'),A);assert.equal(target.searchParams.get('scope'),'ORGANIZATION');assert.equal(target.searchParams.get('level'),'COMPANY');
   assert.equal(await page.locator('[data-opening-ready]').count(),0);assert.equal(await page.getByRole('alert').count(),0);assert.equal(openingReads.filter(q=>!q.action).length,before);
   assert.doesNotMatch(await page.locator('body').innerText(),/No organizations are available|لا توجد مؤسسات متاحة|Loading balances|جار تحميل الأرصدة/);
   await page.screenshot({path:path.join(out,`opening-missing-period-${locale}.png`)});
   await page.getByRole('combobox',{name:locale==='en'?'Organization':'المؤسسة',exact:true}).selectOption(B);
   await page.locator(`[data-opening-ready="${B}"]`).waitFor();assert.equal(await setup.count(),0);assert.equal(openingReads.filter(q=>!q.action).at(-1).organization,B);
   await page.getByText(locale==='en'?'Synthetic customer':'عميل تجريبي',{exact:true}).waitFor();
  }
 });
 await check('Opening context changes cancel an old read and recover without retaining busy or stale balances',async()=>{
  await open('en',B,1440,'opening-balances');await page.locator(`[data-opening-ready="${B}"]`).waitFor();holdOpening=true;pendingOpening=null;
  await page.getByRole('button',{name:'Refresh sources',exact:true}).click();
  for(let attempt=0;attempt<100&&!pendingOpening;attempt++)await new Promise(resolve=>setTimeout(resolve,20));assert.ok(pendingOpening);
  // Parent prop changes represent navigation/embedded financial-setup context changes.
  holdOpeningContext=true;pendingOpeningContext=null;
  await page.evaluate(organization=>window.renderOpening({preferredOrg:organization}),A);
  for(let attempt=0;attempt<100&&!pendingOpeningContext;attempt++)await new Promise(resolve=>setTimeout(resolve,20));assert.ok(pendingOpeningContext);
  assert.equal(await page.locator('[data-opening-ready]').count(),0);assert.equal(await page.getByRole('button',{name:'Save draft',exact:true}).count(),0);
  assert.equal(await page.getByRole('combobox',{name:'Organization',exact:true}).isEnabled(),false);
  await page.getByText('Loading balances and vouchers…',{exact:true}).waitFor();await pendingOpeningContext();
  await page.locator('[data-opening-prerequisite="SETUP"]').waitFor();assert.equal(await page.locator('[data-opening-ready]').count(),0);
  assert.equal(await page.getByRole('combobox',{name:'Organization',exact:true}).isEnabled(),true);
  await pendingOpening();await settle();assert.equal(await page.locator('[data-opening-ready]').count(),0);
  await page.evaluate(organization=>window.renderOpening({preferredOrg:organization}),B);await page.locator(`[data-opening-ready="${B}"]`).waitFor();
  assert.equal(await page.locator('[data-opening-prerequisite]').count(),0);
  contextError=true;await page.evaluate(organization=>window.renderOpening({preferredOrg:organization}),A);await page.getByRole('alert').waitFor();
  assert.equal(await page.locator('[data-opening-ready]').count(),0);assert.equal(await page.locator('[data-opening-prerequisite]').count(),0);assert.equal(await page.getByRole('button',{name:'Save draft',exact:true}).count(),0);
  assert.equal(await page.getByRole('combobox',{name:'Organization',exact:true}).isEnabled(),false);assert.equal(await page.getByRole('combobox',{name:'Organization',exact:true}).inputValue(),'');
  contextError=false;await page.evaluate(organization=>window.renderOpening({preferredOrg:organization}),B);await page.locator(`[data-opening-ready="${B}"]`).waitFor();assert.equal(await page.getByRole('alert').count(),0);
 });
 await check('Opening explicit fiscal dates retain normal errors and retry recovery',async()=>{
  openingError='FISCAL_START_MISMATCH';await open('en',B,1440,'opening-balances','2025-01-01');await page.getByRole('alert').waitFor();
  assert.match(await page.getByRole('alert').innerText(),/matching the organization’s fiscal calendar/);
  assert.equal(await page.getByLabel('Fiscal year start',{exact:true}).inputValue(),'2025-01-01');assert.equal(await page.locator('[data-opening-prerequisite]').count(),0);
  openingError='';await page.getByLabel('Fiscal year start',{exact:true}).fill('2026-01-01');await page.locator(`[data-opening-ready="${B}"]`).waitFor();assert.equal(await page.getByRole('alert').count(),0);
 });
 assert.deepEqual(pageErrors,[]);assert.deepEqual(writes,[]);assert.deepEqual(unexpected,[]);
})().catch(async error=>{
 console.error(error);process.exitCode=1;
 if(page){await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});await writeFile(path.join(out,'failure.txt'),await page.locator('body').innerText().catch(()=>''));}
}).finally(async()=>{
 await mkdir(out,{recursive:true});await writeFile(path.join(out,'result.json'),JSON.stringify({engine:'Actual React component + Chromium + mocked GETs; no Auth or database',passed:checks.filter(check=>check.status==='passed').length,failed:checks.filter(check=>check.status==='failed').length,checks,pageErrors,writes,unexpected},null,2)+'\n');
 await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));if(directory)await rm(directory,{recursive:true,force:true});
});
