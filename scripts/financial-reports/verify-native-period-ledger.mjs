import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';

async function readLedger({page,app,organization,branch}){
 const query=new URLSearchParams({action:'ledger',organization,from:'2026-01-01',to:'2026-12-31'});
 if(branch)query.set('branch',branch);
 const response=await page.request.get(app+'/api/financial-reporting/live-statements?'+query);
 assert.equal(response.status(),200,await response.text());
 assert.equal(response.headers()['cache-control'],'private, no-store');
 const snapshot=await response.json();
 assert.equal(snapshot.origin,'LIVE_CANONICAL_EVENTS');
 assert.equal(snapshot.statements.organizationId,organization);
 assert.equal(snapshot.branchId,branch==='HQ'?null:branch);
 assert.equal(snapshot.periodLedger.totals.openingDebit,snapshot.periodLedger.totals.openingCredit);
 assert.equal(snapshot.periodLedger.totals.periodDebit,snapshot.periodLedger.totals.periodCredit);
 assert.equal(snapshot.periodLedger.totals.closingDebit,snapshot.periodLedger.totals.closingCredit);
 return snapshot;
}

export async function verifyNativeBranchLedger({page,app,out,organization,branch,actor,sql}){
 const company=await readLedger({page,app,organization});
 const selected=await readLedger({page,app,organization,branch});
 const headquarters=await readLedger({page,app,organization,branch:'HQ'});
 assert.deepEqual([company.scope,selected.scope,headquarters.scope],['ORGANIZATION_ALL_ENTITIES','BRANCH','ORGANIZATION_DIRECT']);
 assert.deepEqual([company,selected,headquarters].map(snapshot=>snapshot.statements.cash.opening),['500.0000','300.0000','200.0000']);
 const cash=selected.accounts.find(account=>account.cash&&account.balance==='300.0000');
 assert.ok(cash,'The branch cash account must be present in the canonical source');
 const branchCash=selected.periodLedger.accounts.find(account=>account.id===cash.id);
 assert.equal(branchCash.openingDebit,'300.0000');
 assert.equal(branchCash.closingDebit,'300.0000');
 assert.equal(branchCash.entries.length,0);

 const tab=await page.context().newPage();
 try{
  await tab.setViewportSize({width:1672,height:941});
  await tab.goto(app+'/en/financial-reports?'+new URLSearchParams({screen:'trial-balance',organization,scope:'ORGANIZATION',level:'COMPANY'}));
  const picker=tab.locator('#corp-organization-controls').getByRole('combobox',{name:'Branch',exact:true});
  await picker.locator('option[value="'+branch+'"]').waitFor({state:'attached'});
  await picker.selectOption(branch);
  const row=tab.locator('[data-statement-ready="trial-balance"] [data-ledger-account="'+cash.id+'"]');
  await row.getByText('300.0000',{exact:true}).first().waitFor();
  await row.getByRole('button').click();
  const ledger=tab.locator('[data-statement-ready="general-ledger"]');
  await ledger.waitFor();
  assert.equal(await picker.inputValue(),branch);
  assert.equal(await ledger.getByRole('combobox',{name:'Account',exact:true}).inputValue(),cash.id);
  await tab.screenshot({path:out+'/period-ledger-approved-branch.png',fullPage:true});

  const downloaded=tab.waitForEvent('download');
  await tab.getByRole('button',{name:'Export report',exact:true}).click();
  await tab.getByRole('button',{name:'CSV',exact:true}).click();
  const csv=await downloaded;
  assert.ok(csv.suggestedFilename().includes(branch));
  const content=await readFile(await csv.path(),'utf8');
  assert.ok(content.includes(branch)&&content.includes('300.0000'));
  await csv.saveAs(out+'/period-ledger-approved-branch.csv');

  sql(`update public.organization_members set status='INACTIVE' where organization_id='${organization}' and user_id='${actor.id}'`);
  try{
   await tab.getByRole('button',{name:'Export report',exact:true}).click();
   const denied=tab.waitForResponse(response=>{
    const url=new URL(response.url());
    return url.pathname==='/api/financial-reporting/live-statements'&&url.searchParams.get('action')==='ledger';
   });
   await tab.getByRole('button',{name:'CSV',exact:true}).click();
   assert.equal((await denied).status(),403);
   await tab.locator('.fs-source-error[role=alert]').waitFor();
   assert.equal(await ledger.count(),0);
  }finally{
   sql(`update public.organization_members set status='ACTIVE' where organization_id='${organization}' and user_id='${actor.id}'`);
  }
 }finally{await tab.close()}

 await writeFile(out+'/period-ledger-approved-branch.json',JSON.stringify({
  organization,branch,cashAccount:cash.id,companyOpening:'500.0000',branchOpening:branchCash.openingDebit,
  headquartersOpening:'200.0000',exportRevokedAfterMembershipLoss:true,
 },null,2));
}

export async function verifyNativeFinancingLedger({page,app,out,organization,posted,statements}){
 const snapshot=await readLedger({page,app,organization});
 assert.deepEqual(snapshot.statements,statements);
 const {accounts,totals}=snapshot.periodLedger;
 const cash=accounts.find(account=>account.id==='1000');
 assert.ok(cash);
 assert.equal(cash.openingDebit,'0.0000');
 assert.equal(cash.periodDebit,'300.0000');
 assert.equal(cash.periodCredit,'200.0000');
 assert.equal(cash.closingDebit,'100.0000');
 assert.equal(cash.entries.length,2);
 assert.deepEqual(new Set(cash.entries.map(row=>row.journalId)),new Set(posted));
 assert.deepEqual(cash.entries.map(row=>[row.debit,row.credit]).sort(),[['0.0000','200.0000'],['300.0000','0.0000']]);
 assert.equal(cash.entries.at(-1).balance,'100.0000');
 assert.equal(accounts.find(account=>account.id==='1200')?.closingDebit,'200.0000');
 assert.equal(accounts.find(account=>account.id==='2200')?.closingCredit,'300.0000');
 assert.equal(totals.periodDebit,'500.0000');
 assert.equal(totals.closingDebit,'300.0000');
 await writeFile(out+'/period-ledger-native-financing.json',JSON.stringify({organization,cash,totals},null,2));
}
