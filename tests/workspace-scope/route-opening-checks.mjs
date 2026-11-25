// Read-only opening coverage. These checks exercise module entry points, not
// every tab, accounting transition, entitlement, or all 65 localized routes.
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';

const api=(path,kind='any')=>({path,kind});
const shared=[
 {path:'dashboard',personal:'.platform-personal .platform-summary',business:'.platform-dashboard:not(.platform-personal) .platform-summary'},
 {path:'assets/dashboard',personal:'.yqa-assets-summary .yqa-summary-groups',business:'.org-assets-dashboard[aria-busy="false"] .org-assets-links',businessReads:[api('/api/financial-register','scoped')]},
 {path:'assets',marker:'table[data-scope]',reads:[api('/api/assets')],fixture:'Gold'},
 {path:'investments',marker:'.investment-table',reads:[api('/api/investments','scoped')],fixture:'Deposit'},
 {path:'transactions',marker:'.transaction-table-wrap table',reads:[api('/api/transactions')],fixture:'Gold'},
 {path:'lots',marker:'main table',reads:[api('/api/lots','scoped')],fixture:'Gold'},
 ...['cash-and-banks','financial-position'].map(path=>({path,marker:'.finance-workspace[aria-busy="false"] .finance-metrics',reads:[api('/api/financial-register','scoped')]})),
 ...['receivables','payables','debt-report'].map(path=>({path,marker:'.finance-workspace[aria-busy="false"] .finance-table',reads:[api('/api/financial-register','scoped')]})),
 {path:'debts',marker:'.debt-metrics-caption',reads:[api('/api/debt-overview','scoped')]},
 {path:'loans',marker:'.debt-kpis',personalReads:[api('/api/personal-contracts')],businessReads:[api('/api/debt-contracts','company')]},
 {path:'debt-advances',marker:'.debt-kpis',personalReads:[api('/api/personal-financing')],businessReads:[api('/api/debt-overview','scoped')]},
 {path:'debt-collection',marker:'.debt-collection-alerts',reads:[api('/api/debt-collection','scoped')]},
 {path:'assessments',personal:'#assessment-panel-REGISTER:not([hidden]) .assessment-register',business:'#assessment-panel-MANUAL:not([hidden])',personalReads:[api('/api/assessments/report'),api('/api/zakat-cycles')],businessReads:[api('/api/assessments/manual','company')],businessText:'Scope assessment A'},
 {path:'payments',personal:'.zpay-kpis',business:'h1:text-is("Corporate Zakat payments")',personalReads:[api('/api/payments'),api('/api/zakat-cycles')],businessReads:[api('/api/liquidity','company'),api('/api/assessments/manual','company')],businessText:'Matching operations: 0'},
 {path:'reports',marker:'.asset-report-kpis',reads:[api('/api/assets'),api('/api/transactions')]},
];
const account=[
 {path:'settings/system',marker:'[data-system-preferences] form',reads:[api('/api/settings')],account:true},
 {path:'account',marker:'.account-summary',reads:[api('/api/settings')],account:true},
];
const personal=[...shared,
 {path:'financial-reports',marker:'.fs-personal-period small',reads:[api('/api/financial-reporting/personal')]},
 {path:'settings/personal-setup',marker:'.personal-setup-panel'},
 ...account,
];
const business=[...shared,
 {path:'liquidity',marker:'.liq-kpi-grid',reads:[api('/api/liquidity','company')]},
 {path:'vat',marker:'.vat-config-summary-trigger',reads:[api('/api/vat','company')]},
 {path:'budget-planning',marker:'.budget-tabs',reads:[api('/api/budget-plans','company')]},
 {path:'organizations',marker:'.orgs-list-item',reads:[api('/api/organizations')]},
 {path:'users',marker:'nav[aria-label="User and role management"]',reads:[api('/api/organizations/users','company'),api('/api/organizations/roles','company'),api('/api/organizations/permissions','company')]},
 {path:'billing',marker:'.yb-overview-grid',reads:[api('/api/subscriptions','company'),api('/api/subscriptions/requests','company')]},
 {path:'settings',marker:'.organization-details-workspace',reads:[api('/api/organizations/entities','company')]},
 {path:'settings/financial',marker:'[data-financial-settings] .settings-finance-status',reads:[api('/api/financial-reporting/setup-readiness','company')]},
 {path:'settings/regulatory',marker:'[data-regulatory-workspace]',reads:[api('/api/organizations')]},
 {path:'settings/team',marker:'.settings-team-access-summary',reads:[api('/api/organizations/users','company'),api('/api/organizations/permissions','company')]},
 {path:'settings/structure',marker:'[data-structure-workspace] .settings-data-table',reads:[api('/api/organizations/entities','company')]},
 {path:'settings/financial/setup',marker:'[data-financial-setup]',reads:[api('/api/financial-reporting/setup-readiness','company')]},
 ...['employee-advances','debt-openings'].map(path=>({path,marker:'.debt-kpis',reads:[api('/api/debt-contracts','company')]})),
 ...account,
];

export const routeOpeningCoverage=Object.freeze({
 locale:'en',viewport:{width:1440,height:1000},
 personal:personal.map(({path})=>path),organization:business.map(({path})=>path),
 exclusions:[
  'Corporate financial-reports, chart, opening and posting-policy readiness require approved accounting fixtures and are exercised by the separate financial-opening workflow.',
  'Feasibility enrollment and subscription gates are exercised by the separate subscription workflow; personal exchange rates belong to PR #522.',
  'Auth/admin/preview/share routes, legacy aliases, record detail routes, fiscal and branch/center subpages, notifications/guide/governance and inactive workflow information are outside this main-entry sweep.',
  'This sweep does not create transactions, approve assessments, settle payments, change preferences, or claim every tab and financial workflow is verified.',
 ],
});

function matchesRead(response,read,scope,organizationId){
 const url=new URL(response.url());
 if(response.request().method()!=='GET'||url.pathname!==read.path)return false;
 if(read.kind==='scoped'&&url.searchParams.get('scope')!==scope)return false;
 if(read.kind==='company'||read.kind==='scoped'&&scope==='ORGANIZATION'){
  if((url.searchParams.get('organization_id')??url.searchParams.get('organization'))!==organizationId)return false;
  if(url.searchParams.get('group')==='1'||url.searchParams.get('scope')==='group')return false;
 }
 return true;
}

const errorSelectors=[
 '.finance-error','.fs-source-error','.liq-error','.orgs-notice.error',
 '.vat-registration-load-error','.settings-finance-readiness-error',
 '.financial-setup-notice.error','.investment-workspace .error',
 '[data-workspace-organization-unavailable]',
].join(',');
const failureText=/unable to|could not|failed to|something went wrong|application error|internal server error|not authorized|access denied|organization unavailable|تعذر|غير مصرح|انتهت جلسة/i;

/** Requires the existing synthetic owner, two companies and Gold/Deposit fixtures.
 * All navigation is local and all /api requests must be reads. The failed page
 * stays open so the main runner can capture its sanitized visible diagnostics.
 */
export async function routeOpeningAcceptance({context,app,organizationId,check}){
 assert.ok(['localhost','127.0.0.1'].includes(new URL(app).hostname),'LOCAL_APP_REQUIRED');
 assert.ok(organizationId,'SYNTHETIC_ORGANIZATION_REQUIRED');
 const outcomes=[];
 for(const [scope,specs] of [['PERSONAL',personal],['ORGANIZATION',business]]){
  for(const spec of specs){
   await check(`Main module opens: ${scope} /en/${spec.path}`,async()=>{
    const page=await context.newPage();
    await page.setViewportSize(routeOpeningCoverage.viewport);
    page.setDefaultTimeout(30000);
    const errors=[],failedReads=[],writes=[],completed=[];
    const pending=new Set();
    const required=spec.reads??(scope==='PERSONAL'?spec.personalReads:spec.businessReads)??[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.route(app+'/api/**',async route=>{
     const request=route.request();
     if(!['GET','HEAD','OPTIONS'].includes(request.method())){
      writes.push(request.method()+' '+new URL(request.url()).pathname);
      await route.abort('blockedbyclient');return;
     }
     await route.continue();
    });
    page.on('response',response=>{
     if(!response.url().startsWith(app+'/api/')||response.request().method()!=='GET')return;
     const task=(async()=>{
      // Consume only to wait for completion; no response bodies or auth data
      // are stored in artifacts.
      if(await response.finished())return;
      if(!response.ok())failedReads.push(new URL(response.url()).pathname+' HTTP '+response.status());
      else completed.push(response);
     })().catch(()=>{}).finally(()=>pending.delete(task));
     pending.add(task);
    });
    const query=new URLSearchParams({scope});
    if(scope==='ORGANIZATION'&&!spec.account){query.set('organization',organizationId);query.set('level','COMPANY');}
    const response=await page.goto(app+'/en/'+spec.path+'?'+query,{waitUntil:'domcontentloaded',timeout:90000});
    assert.equal(response?.status(),200,'Expected a successful authenticated page');
    assert.equal(new URL(page.url()).pathname,'/en/'+spec.path,'Unexpected redirect');
    await page.locator('.corp-workspace-scope button[aria-pressed="true"]').filter({hasText:scope==='PERSONAL'?'Personal':'Business'}).waitFor();
    const deadline=Date.now()+30000;
    while(!required.every(read=>completed.some(response=>matchesRead(response,read,scope,organizationId)))){
     assert.deepEqual(writes,[],'Opening a route attempted an API mutation');
     assert.deepEqual(errors,[],'Browser exception');
     assert.deepEqual(failedReads,[],'Module read failed');
     assert.ok(Date.now()<deadline,'Required module reads did not finish: '+required.filter(read=>!completed.some(response=>matchesRead(response,read,scope,organizationId))).map(read=>read.path).join(', '));
     await delay(50);
    }
    const marker=spec.marker??(scope==='PERSONAL'?spec.personal:spec.business);
    await page.locator(marker).first().waitFor();
    if(scope==='ORGANIZATION'&&spec.businessText)await page.getByText(spec.businessText,{exact:false}).first().waitFor();
    if(spec.fixture){
     const expected=`Scope ${scope==='PERSONAL'?'Personal':'Company A'} ${spec.fixture}`;
     const other=`Scope ${scope==='PERSONAL'?'Company A':'Personal'} ${spec.fixture}`;
     const table=page.locator('main table, .investment-table table');
     await table.getByText(expected,{exact:false}).first().waitFor();
     assert.equal(await table.getByText(other,{exact:false}).count(),0,'Other scope appeared in module records');
     assert.equal(await table.getByText(`Scope Company B ${spec.fixture}`,{exact:false}).count(),0,'Another company appeared in company records');
    }
    // React may commit the result immediately after the body finishes.
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    await Promise.allSettled([...pending]);
    const final=new URL(page.url());
    assert.equal(final.searchParams.get('scope'),scope,'Scope changed while opening the module');
    if(scope==='PERSONAL')for(const key of ['organization','organization_id','entity','entity_id','group','level'])assert.equal(final.searchParams.has(key),false,'Personal URL retained '+key);
    else if(!spec.account){
     assert.equal(final.searchParams.get('organization'),organizationId,'Company changed while opening the module');
     const picker=page.locator('#corp-organization-controls select').first();
     if(await picker.count())assert.equal(await picker.inputValue(),organizationId,'Banner shows a different company');
    }
    assert.equal(await page.locator(errorSelectors).filter({visible:true}).count(),0,'Module rendered an error state');
    const alerts=await page.locator('[role="alert"]').filter({visible:true}).allTextContents();
    assert.ok(!alerts.some(text=>failureText.test(text)),'Visible load failure: '+alerts.filter(text=>failureText.test(text)).join(' | ').slice(0,500));
    assert.deepEqual(writes,[],'Opening a route attempted an API mutation');
    assert.deepEqual(failedReads,[],'Module read failed');
    assert.deepEqual(errors,[],'Browser exception');
    outcomes.push({scope,path:'/en/'+spec.path,status:'opened',verifiedReads:required.map(({path})=>path),recordIsolation:Boolean(spec.fixture)});
    await page.close();
   });
  }
 }
 return {...routeOpeningCoverage,checks:outcomes};
}
