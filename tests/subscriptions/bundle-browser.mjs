import assert from 'node:assert/strict';
export async function bundleBrowser({browser,cookies,appUrl,url,headers,owner,rpc,root}){
 const before=(await rpc(owner,'subscription_plan_catalog',{})).data;
 const created=await fetch(url+'/rest/v1/organizations',{method:'POST',headers:{...headers(owner),Prefer:'return=representation'},body:JSON.stringify({name:'Bundle browser institution',owner_user_id:owner.id})});assert.equal(created.status,201);const org=(await created.json())[0].id;
 const context=await browser.newContext();await context.addCookies(cookies.map(c=>({name:c.name,value:c.value,url:appUrl})));const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const posted=path=>page.waitForResponse(r=>r.url()===appUrl+path&&r.request().method()==='POST');
 try{
  await page.goto(appUrl+'/admin/subscriptions?lang=en&tab=modules');await page.locator('.bundle-admin table').waitFor();
  await page.getByRole('row').filter({hasText:'Assets and transactions'}).getByRole('button',{name:'Edit',exact:true}).click();
  await page.getByLabel(/^Pricing method/).selectOption('fixed');
  await page.getByLabel('Monthly price',{exact:true}).fill('10.25');await page.getByLabel('Annual price',{exact:true}).fill('100');await page.getByLabel('Change reason',{exact:true}).fill('Isolated module pricing acceptance');
  let saved=posted('/api/admin/subscriptions/modules');await page.getByRole('button',{name:'Save settings',exact:true}).click();assert.equal((await saved).status(),200);
  await page.getByText('Saved and audited.',{exact:true}).waitFor();await page.reload();
  const modules=(await rpc(owner,'subscription_bundle_catalog',{})).data;assert.equal(modules.find(m=>m.key==='assets').monthly,10.25);
  await page.screenshot({path:new URL('tests/subscriptions/screenshots/bundle-admin-pricing.png',root).pathname,fullPage:true});
  await page.goto(appUrl+'/en/billing?organization='+org+'&section=builder');await page.locator('[data-module="budgets"] button').click();await page.locator('.bundle-consent input').check();
  saved=posted('/api/subscriptions/bundles');await page.locator('.bundle-summary .bundle-primary').click();let result=await saved;assert.equal(result.status(),200);const request=await result.json();assert.equal(request.status,'pending');assert.equal(request.total,null);
  await page.locator('.bundle-history article').waitFor();await page.reload();await page.locator('.bundle-history article').waitFor();assert.ok(await page.locator('.bundle-summary .bundle-primary').isDisabled());
  await page.goto(appUrl+'/admin/subscriptions?lang=en&tab=quotes');await page.getByRole('row').filter({hasText:'Bundle browser institution'}).getByRole('button',{name:'Prepare quote',exact:true}).click();
  await page.locator('[name="total"]').fill('145.75');await page.locator('[name="max_users"]').fill('5');await page.getByLabel('Decision notes for customer',{exact:true}).fill('Synthetic browser quote terms');
  saved=posted('/api/admin/subscriptions/modules');await page.getByRole('button',{name:'Send quote',exact:true}).click();assert.equal((await saved).status(),200);
  await page.goto(appUrl+'/ar/billing?organization='+org+'&section=builder');await page.getByRole('button',{name:'قبول العرض وطلب التفعيل',exact:true}).waitFor();
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(350);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:new URL('tests/subscriptions/screenshots/bundle-customer-quote-mobile.png',root).pathname,fullPage:true});
  saved=posted('/api/subscriptions/bundles');await page.getByRole('button',{name:'قبول العرض وطلب التفعيل',exact:true}).click();assert.equal((await saved).status(),200);
  await page.setViewportSize({width:1440,height:1000});await page.goto(appUrl+'/admin/subscriptions?lang=en&tab=quotes');await page.getByRole('row').filter({hasText:'Bundle browser institution'}).getByRole('button',{name:'Activate',exact:true}).click();await page.getByLabel('Decision notes for customer',{exact:true}).fill('Activate accepted synthetic bundle');
  saved=posted('/api/admin/subscriptions/modules');await page.getByRole('button',{name:'Confirm activation',exact:true}).click();assert.equal((await saved).status(),200);
  const e=(await rpc(owner,'organization_subscription',{p_organization_id:org})).data;assert.equal(e.status,'active');assert.equal(e.plan.price_amount,145.75);assert.deepEqual([...e.capabilities].sort(),['module:assets','module:budgets','module:liquidity']);
  assert.deepEqual((await rpc(owner,'subscription_plan_catalog',{})).data,before);assert.deepEqual(errors,[]);
 }finally{await context.close();}
}
