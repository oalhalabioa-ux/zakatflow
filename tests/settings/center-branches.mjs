import assert from 'node:assert/strict';
export async function verifyCenterBranches({page,app,orgId}){
 const center='20000000-0000-4000-8000-000000000002',branch='30000000-0000-4000-8000-000000000003';
 const pattern='**/api/financial-reporting/center-branches*';
 let revision=0,assignments=[];const writes=[];
 await page.route(pattern,async route=>{
  const request=route.request();
  if(request.method()==='POST'){
   const body=request.postDataJSON();writes.push(body);assert.equal(body.organization,orgId);assert.equal(body.expectedRevision,revision);
   if(body.action==='transfer')assignments[0].to='2027-12-31';
   revision++;assignments.push({id:'assignment-'+revision,organizationId:orgId,centerId:center,branchId:body.branch,from:body.from,to:body.to??null,status:'APPROVED',approvedBy:'owner',revision:String(revision)});
   return route.fulfill({json:{id:'assignment-'+revision,revision,status:'APPROVED'}});
  }
  await route.fulfill({json:{organizationId:orgId,complete:true,revision:String(revision),branches:[branch],centerIds:[center],assignments}});
 });
 const centers='**/api/organizations/cost-centers*',entities='**/api/organizations/entities*';
 await page.route(centers,route=>route.fulfill({json:[{id:center,organization_id:orgId,name:'Sales center',active:true}]}));
 await page.route(entities,route=>route.fulfill({json:[{id:branch,organization_id:orgId,name:'Riyadh branch',entity_type:'BRANCH',active:true}]}));
 try{
  await page.goto(`${app}/en/settings/structure?organization=${orgId}`);
  const panel=page.getByRole('region',{name:'Center branch assignments'});
  await panel.getByLabel('Center',{exact:true}).selectOption(center);
  await panel.getByLabel('Branch',{exact:true}).selectOption(branch);
  await panel.getByLabel('Effective date',{exact:true}).fill('2027-01-01');
  await panel.getByLabel('Assignment or transfer reason',{exact:true}).fill('Initial branch assignment');
  await panel.getByRole('button',{name:'Save assignment',exact:true}).click();
  await panel.getByText('Assignment saved in the history.',{exact:true}).waitFor();
  await page.reload();await panel.getByRole('cell',{name:'Riyadh branch',exact:true}).waitFor();
  await panel.getByLabel('Center',{exact:true}).selectOption(center);
  await panel.getByLabel('Branch',{exact:true}).selectOption('');
  await panel.getByLabel('Effective date',{exact:true}).fill('2028-01-01');
  await panel.getByLabel('Assignment or transfer reason',{exact:true}).fill('Move to HQ');
  await panel.getByRole('button',{name:'Save assignment',exact:true}).click();
  await panel.getByRole('cell',{name:'2027-12-31',exact:true}).waitFor();
  assert.equal(writes.length,2);assert.equal(writes[1].action,'transfer');assert.equal(writes[1].branch,null);
  for(const width of [1490,390]){await page.setViewportSize({width,height:1050});await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(200);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Assignment editor must fit viewport');}
 }finally{await page.unroute(pattern);await page.unroute(centers);await page.unroute(entities);}
}
