import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';

const value=result=>{if(result.error)throw Error(result.error.message);return result.data;};
const scopeButtons=page=>page.locator('.corp-workspace-scope button').filter({visible:true});
const pickerFor=page=>page.getByRole('combobox',{name:'Company',exact:true}).filter({visible:true});
async function waitCompany(page,id){
 await page.waitForFunction(id=>[...document.querySelectorAll('#corp-organization-controls select')]
  .some(select=>select.getClientRects().length&&select.value===id),id);
}
async function json(response,status){
 const body=await response.json();assert.equal(response.status(),status,JSON.stringify(body));return body;
}

// Genuine local Auth/API/RLS/persistence proof. Mocked operation races are
// exported separately below and are identified as such in the acceptance log.
export async function fxIntegrationAcceptance({app,ownerContext,outsiderContext,freshContext,owner,other,fresh,orgA,orgB,foreignOrg,sql,check,pageErrors}){
 assert.equal(new URL(app).hostname,'localhost','FX acceptance is disposable-loopback only');
 const request=(context,method,path,data)=>context.request.fetch(app+path,{method,headers:{Origin:app},...(data===undefined?{}:{data})});
 const ownerRequest=(method,path,data)=>request(ownerContext,method,path,data);
 const post=(context,payload)=>request(context,'POST','/api/fx',payload).then(response=>json(response,201));
 const base={from_currency:'USD',to_currency:'SAR',valuation_date:'2026-11-07',source:'Scope FX fixture'};
 const globalId=randomUUID();
 let inverse,future,companyA,companyB,outsiderRate,freshRate;
 await check('Integrated FX: authenticated owners save personal and company rates with idempotent retries',async()=>{
  sql(`insert into public.fx_rates(id,from_currency,to_currency,rate,valuation_date,source)
   values('${globalId}','USD','SAR',3.75,'2026-11-01','Scope FX global reference');`);
  const first=await post(ownerContext,{...base,scope:'PERSONAL',from_currency:'SAR',to_currency:'USD',rate:0.24});
  inverse=await post(ownerContext,{...base,scope:'PERSONAL',from_currency:'SAR',to_currency:'USD',rate:0.25});
  assert.equal(inverse.id,first.id);assert.equal(Number(inverse.rate),0.25);
  future=await post(ownerContext,{...base,scope:'PERSONAL',valuation_date:'2026-11-08',rate:9});
  companyA=await post(ownerContext,{...base,organization_id:orgA,rate:3.8});
  companyB=await post(ownerContext,{...base,organization_id:orgB,rate:3.9});
  outsiderRate=await post(outsiderContext,{...base,scope:'PERSONAL',rate:17});
  freshRate=await post(freshContext,{...base,scope:'PERSONAL',rate:4.4});
  assert.equal(value(await fresh.client.rpc('organization_onboarding_required')),true,'Personal FX must not create or require an institution');
 });
 await check('Integrated FX: personal/company/other-user reads stay isolated and forged writes are denied',async()=>{
  const personal=await json(await ownerRequest('GET','/api/fx?scope=PERSONAL'),200);
  assert.deepEqual(personal.filter(row=>row.scope==='PERSONAL').map(row=>row.id).sort(),[inverse.id,future.id].sort());
  assert.ok(personal.some(row=>row.id===globalId&&row.scope==='GLOBAL'));
  for(const [organization,expected] of [[orgA,companyA],[orgB,companyB]]){
   const rows=await json(await ownerRequest('GET','/api/fx?scope=ORGANIZATION&organization_id='+organization),200);
   assert.deepEqual(rows.filter(row=>row.organization_id).map(row=>row.id),[expected.id]);
   assert.ok(rows.some(row=>row.id===globalId));
   assert.ok(rows.every(row=>![inverse.id,future.id,outsiderRate.id].includes(row.id)));
  }
  const otherRows=await json(await request(outsiderContext,'GET','/api/fx?scope=PERSONAL'),200);
  assert.deepEqual(otherRows.filter(row=>row.scope==='PERSONAL').map(row=>row.id),[outsiderRate.id]);
  // Existing corporate GET may return shared reference rows; RLS must exclude every private company row.
  const foreignRead=await json(await request(outsiderContext,'GET','/api/fx?organization_id='+orgA),200);
  assert.ok(foreignRead.every(row=>row.organization_id===null));
  assert.equal((await request(outsiderContext,'POST','/api/fx',{...base,organization_id:orgA,rate:99})).status(),403);
  assert.equal((await ownerRequest('POST','/api/fx',{...base,organization_id:foreignOrg,rate:99})).status(),403);
  assert.equal((await ownerRequest('GET','/api/fx?scope=PERSONAL&organization_id='+orgA)).status(),400);
  assert.equal((await ownerRequest('POST','/api/fx',{...base,scope:'PERSONAL',user_id:other.id,rate:99})).status(),400);
  assert.deepEqual(value(await other.client.from('personal_fx_rates').select('id').eq('user_id',owner.id)),[]);
  assert.deepEqual(value(await other.client.from('personal_fx_rates').update({rate:99}).eq('id',inverse.id).select('id')),[]);
  const forged=await other.client.from('personal_fx_rates').insert({...base,user_id:owner.id,source:'Scope forged owner',rate:99});
  assert.ok(forged.error,'Direct PostgREST must reject an owner-forged personal rate');
  assert.equal(Number(value(await owner.client.from('personal_fx_rates').select('rate').eq('id',inverse.id).single()).rate),0.25);
 });
 await check('Integrated FX: asset quotes respect owner, company, historical date, inverse direction and global fallback',async()=>{
  const quote=(context,date,organization)=>request(context,'GET','/api/assets/fx?'+new URLSearchParams({currency:'USD',date,...(organization?{organization_id:organization}:{})})).then(response=>json(response,200));
  for(const [context,date,organization,expected,id] of [
   [ownerContext,'2026-11-06',null,3.75,globalId],
   [ownerContext,'2026-11-07',null,4,inverse.id],
   [ownerContext,'2026-11-08',null,9,future.id],
   [ownerContext,'2026-11-07',orgA,3.8,companyA.id],
   [ownerContext,'2026-11-07',orgB,3.9,companyB.id],
   [outsiderContext,'2026-11-07',null,17,outsiderRate.id],
   [freshContext,'2026-11-07',null,4.4,freshRate.id],
  ]){
   const row=await quote(context,date,organization);assert.equal(row.base_currency,'SAR');assert.equal(row.rate,expected);assert.equal(row.row.id,id);
  }
  const denied=await request(outsiderContext,'GET',`/api/assets/fx?currency=USD&date=2026-11-07&organization_id=${orgA}`);
  assert.equal(denied.status(),400);assert.equal((await denied.json()).error,'ORGANIZATION_ACCESS_REQUIRED');
 });
 await check('Integrated FX: personal asset creation and opening edit persist the same dated private quote',async()=>{
  const asset=await json(await ownerRequest('POST','/api/assets',{
   request_id:randomUUID(),asset_type:'OTHER',name:'Scope FX personal opening',currency:'USD',unit:'unit',is_zakatable:false,ownership_scope:'PERSONAL',
   metadata:{acquisition_mode:'OPENING_BALANCE',purchase_date:'2026-11-07',purchase_value:100,quantity:1},
  }),201);
  assert.ok(asset.id);assert.equal(Number(asset.metadata.fx_rate),4);assert.equal(asset.metadata.fx_rate_id,inverse.id);
  const inspection=await json(await ownerRequest('GET','/api/assets/opening?asset_id='+asset.id),200);
  assert.equal(inspection.can_edit,true);
  await json(await ownerRequest('POST','/api/assets/opening',{
   action:'UPDATE',asset_id:asset.id,expected_updated_at:inspection.asset.updated_at,
   changes:{name:asset.name,date:'2026-11-07',amount:125,quantity:1,purpose:''},
  }),200);
  const saved=await json(await ownerRequest('GET','/api/assets/opening?asset_id='+asset.id),200);
  assert.equal(Number(saved.asset.metadata.acquisition_cost_base),500);assert.equal(saved.asset.metadata.fx_rate_id,inverse.id);
  const transaction=value(await owner.client.from('transactions').select('base_value,metadata').eq('asset_account_id',asset.id).single());
  assert.equal(Number(transaction.base_value),500);assert.equal(transaction.metadata.fx_rate_id,inverse.id);
  const lot=value(await owner.client.from('lots').select('original_value_base,remaining_value_base').eq('asset_account_id',asset.id).single());
  assert.equal(Number(lot.original_value_base),500);assert.equal(Number(lot.remaining_value_base),500);
  assert.equal((await request(outsiderContext,'GET','/api/assets/opening?asset_id='+asset.id)).status(),403);
 });

 const page=await ownerContext.newPage();page.setDefaultTimeout(20000);page.setDefaultNavigationTimeout(90000);
 page.on('pageerror',error=>pageErrors.push(error.message));
 const sources={personal:'Scope FX UI personal',a:'Scope FX UI company A',b:'Scope FX UI company B'};
 const save=async(source,rate,organization)=>{
  await page.getByRole('combobox',{name:/^From currency(?:\s|$)/}).selectOption('USD');
  await page.getByRole('combobox',{name:/^To currency(?:\s|$)/}).selectOption('SAR');
  await page.getByLabel('Exchange rate',{exact:true}).fill(String(rate));
  await page.getByLabel('Rate date',{exact:true}).fill('2026-12-01');
  await page.getByLabel('Rate source',{exact:true}).fill(source);
  const pending=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/fx'&&response.request().method()==='POST');
  await page.getByRole('button',{name:'Save FX rate',exact:true}).click();
  const response=await pending,body=await json(response,201),sent=response.request().postDataJSON();
  if(organization){assert.equal(sent.organization_id,organization);assert.equal(sent.scope,undefined);}
  else{assert.equal(sent.scope,'PERSONAL');assert.equal(sent.organization_id,undefined);}
  await page.getByRole('cell',{name:source,exact:true}).waitFor();
  await page.reload();await page.getByRole('cell',{name:source,exact:true}).waitFor();
  return body;
 };
 await check('Integrated FX UI: banner Personal to company A to company B saves and reloads only the active owner',async()=>{
  await page.goto(app+`/en/prices?scope=PERSONAL&organization=${orgB}&level=GROUP`);
  await page.getByRole('heading',{name:'Record an FX rate',exact:true}).waitFor();
  await page.waitForFunction(()=>!new URL(location.href).searchParams.has('organization'));
  const reference=page.getByTestId('personal-fx-reference');
  await page.getByLabel('Rate date',{exact:true}).fill('2024-02-29');
  assert.match(await reference.innerText(),/1 USD = 3\.75 SAR.*2024-02-29.*Saudi Central Bank/s);
  await page.getByRole('combobox',{name:/^From currency(?:\s|$)/}).selectOption('SAR');
  await page.getByRole('combobox',{name:/^To currency(?:\s|$)/}).selectOption('USD');
  assert.match(await reference.innerText(),/1 SAR = 0\.266666666667 USD/);
  await page.getByLabel('Rate date',{exact:true}).fill('2099-01-01');
  assert.equal(await reference.getByRole('link').count(),0);
  assert.equal(await page.getByLabel('Exchange rate',{exact:true}).inputValue(),'');
  assert.equal(await pickerFor(page).count(),0);
  await save(sources.personal,4.01,null);
  await scopeButtons(page).filter({hasText:'Business'}).click();
  const picker=pickerFor(page);await picker.waitFor();await picker.selectOption(orgA);await waitCompany(page,orgA);
  await page.getByRole('cell',{name:'Scope FX fixture',exact:true}).waitFor();
  assert.equal(await page.getByRole('cell',{name:sources.personal,exact:true}).count(),0);
  assert.equal(await reference.count(),0);
  await save(sources.a,3.81,orgA);
  await pickerFor(page).selectOption(orgB);await waitCompany(page,orgB);
  await page.getByRole('cell',{name:'Scope FX fixture',exact:true}).waitFor();
  assert.equal(await page.getByRole('cell',{name:sources.a,exact:true}).count(),0);
  await save(sources.b,3.91,orgB);
  await scopeButtons(page).filter({hasText:'Personal'}).click();
  await page.getByRole('cell',{name:sources.personal,exact:true}).waitFor();
  assert.equal(await page.getByRole('cell',{name:sources.a,exact:true}).count(),0);
  assert.equal(await page.getByRole('cell',{name:sources.b,exact:true}).count(),0);
  assert.equal(new URL(page.url()).searchParams.has('organization'),false);
 });
 await check('Integrated FX UI: explicit unavailable company stays blank and valid URL outranks remembered company',async()=>{
  const reads=[];page.on('request',request=>{if(request.method()==='GET'&&new URL(request.url()).pathname==='/api/fx')reads.push(new URL(request.url()));});
  await page.goto(app+`/en/prices?scope=ORGANIZATION&organization=${foreignOrg}`);
  await page.locator('[data-workspace-organization-unavailable]').filter({visible:true}).waitFor();
  assert.equal(await pickerFor(page).inputValue(),'');
  assert.equal(await page.getByRole('button',{name:'Save FX rate',exact:true}).isEnabled(),false);
  assert.equal(reads.length,0,'An unavailable company must not trigger a remembered-company FX fetch');
  await page.goto(app+`/en/prices?scope=ORGANIZATION&organization=${orgA}`);
  await waitCompany(page,orgA);await page.getByRole('cell',{name:sources.a,exact:true}).waitFor();
  assert.ok(reads.length>0);assert.ok(reads.every(url=>url.searchParams.get('organization_id')===orgA));
  assert.equal(await page.getByRole('cell',{name:sources.b,exact:true}).count(),0);
 });
 await check('Integrated FX UI: personal additions can use the official quote or an actual rate without changing the earlier opening',async()=>{
  const asset=value(await owner.client.from('asset_accounts').select('id').eq('name','Scope FX personal opening').single());
  await page.goto(app+'/en/transactions?scope=PERSONAL');
  const open=()=>page.getByRole('button',{name:'Add transaction',exact:true}).click();
  const form=page.locator('#transaction-entry');
  const reference=form.getByTestId('apply-personal-fx-reference');
  const rate=form.getByLabel('سعر الصرف',{exact:true});
  const date=form.getByLabel('التاريخ',{exact:true});
  async function enter(){
   await open();
   await form.getByLabel('الأصل',{exact:true}).selectOption(asset.id);
   await form.getByLabel('النوع',{exact:true}).selectOption('ADD');
   await date.fill('2026-11-09');
   await form.getByLabel('سعر الوحدة',{exact:true}).fill('100');
   await reference.click();
   assert.equal(await rate.inputValue(),'3.75');
  }
  async function save(expectedRate,expectedBase){
   const pending=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/transactions'&&response.request().method()==='POST');
   await form.getByRole('button',{name:'Save transaction',exact:true}).click();
   const response=await pending;
   assert.ok(response.ok(),await response.text());
   assert.equal(Number(response.request().postDataJSON().fx_rate),expectedRate);
   const id=(await response.json()).id;
   const stored=value(await owner.client.from('transactions').select('currency,gross_value,base_value,metadata').eq('id',id).single());
   assert.deepEqual([stored.currency,Number(stored.gross_value),Number(stored.base_value)],['USD',100,expectedBase]);
   assert.equal(Number(stored.metadata.fx_rate),expectedRate);
   await form.waitFor({state:'hidden'});
  }
  await enter();await date.fill('2099-01-01');
  assert.equal(await reference.count(),0);
  assert.equal(await rate.inputValue(),'');
  await date.fill('2026-11-09');await reference.click();await save(3.75,375);
  await enter();await rate.fill('3.92');await save(3.92,392);
  const prior=value(await owner.client.from('transactions').select('base_value,metadata').eq('asset_account_id',asset.id).eq('transaction_type','OPENING_BALANCE').single());
  assert.equal(Number(prior.base_value),500);
  assert.equal(prior.metadata.fx_rate_id,inverse.id);
 });
 await page.close();
 return {realAuth:true,privateRateOwner:owner.id,companies:[orgA,orgB],historicalInverseRate:4,openingValueBase:500};
}

// The POST responses in these two checks are deliberately mocked. They prove
// client operation isolation, separately from the persisted real-Auth cases.
export async function fxPendingSaveAcceptance({context,app,orgA,orgB,check,pageErrors=[]}){
 assert.ok(['localhost','127.0.0.1'].includes(new URL(app).hostname));
 for(const returnsToA of [false,true]){
  const page=await context.newPage();page.setDefaultTimeout(20000);page.setDefaultNavigationTimeout(90000);
  page.on('pageerror',error=>pageErrors.push(error.message));
  const pending=[],reads=[];
  page.on('request',request=>{if(request.method()==='GET'&&new URL(request.url()).pathname==='/api/fx')reads.push(request.url());});
  await page.route('**/api/fx',async route=>{
   if(route.request().method()!=='POST')return route.fallback();
   pending.push({route,body:route.request().postDataJSON()});
  });
  const waitPending=async count=>{for(let i=0;i<250&&pending.length<count;i++)await delay(20);assert.equal(pending.length,count);};
  const waitForRates=id=>page.waitForResponse(response=>{
   const url=new URL(response.url());return response.request().method()==='GET'&&url.pathname==='/api/fx'&&url.searchParams.get('organization_id')===id;
  });
  const finishRead=async pending=>{assert.equal((await pending).status(),200);await (await pending).finished();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));};
  await check(`FX operation race (mocked POST): ${returnsToA?'A to B to A failure':'A to B success'} cannot alter a newer draft or save`,async()=>{
   let loaded=waitForRates(orgB);
   await page.goto(app+`/en/prices?scope=ORGANIZATION&organization=${orgB}`);
   await waitCompany(page,orgB);await finishRead(loaded);
   await page.evaluate(()=>history.pushState(null,'',location.href));
   loaded=waitForRates(orgA);await pickerFor(page).selectOption(orgA);await waitCompany(page,orgA);await finishRead(loaded);
   const rate=page.getByLabel('Exchange rate',{exact:true});
   await rate.fill('3.81');await page.getByRole('button',{name:'Save FX rate',exact:true}).click();
   await waitPending(1);assert.equal(pending[0].body.organization_id,orgA);
   assert.equal(await pickerFor(page).isEnabled(),false);
   loaded=waitForRates(orgB);await page.goBack();await waitCompany(page,orgB);await finishRead(loaded);
   if(returnsToA){loaded=waitForRates(orgA);await page.goForward();await waitCompany(page,orgA);await finishRead(loaded);}
   await page.getByRole('button',{name:'Save FX rate',exact:true}).waitFor();
   assert.equal(await page.getByRole('button',{name:'Save FX rate',exact:true}).isEnabled(),true);
   await rate.fill('8.88');await page.getByRole('button',{name:'Save FX rate',exact:true}).click();
   await waitPending(2);assert.equal(pending[1].body.organization_id,returnsToA?orgA:orgB);
   const beforeReads=reads.length;
   const oldResponse=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/fx'&&response.request().postDataJSON()?.rate===3.81);
   await pending[0].route.fulfill({status:returnsToA?400:201,json:returnsToA?{error:'DELAYED_OLD_COMPANY_FAILURE'}:{id:randomUUID(),...pending[0].body}});
   await (await oldResponse).finished();
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   assert.equal(await rate.inputValue(),'8.88');
   assert.equal(await page.getByRole('button',{name:'Saving…',exact:true}).isEnabled(),false,'Old finally must not unlock the current save');
   assert.equal(await page.locator('.prices-notice').count(),0,'Old success/error must not enter the current company');
   assert.equal(reads.length,beforeReads,'Old completion must not reload the current company');
   await pending[1].route.fulfill({status:201,json:{id:randomUUID(),...pending[1].body}});
   await page.getByRole('status').filter({hasText:'FX rate saved for this organization.'}).waitFor();
   assert.equal(await rate.inputValue(),'');
  });
  await page.close();
 }
 return {mockedPostResponses:true,cases:2};
}
