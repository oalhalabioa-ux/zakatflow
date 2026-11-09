// Visual/interaction fixtures only; actual SQL authorization and pricing are tested separately.
import assert from 'node:assert/strict';
export async function verifyBundleBuilder({page,locale,out,organizationId}){
 const ar=locale==='ar';
 const modules=[['assets','الأصول والعمليات','Assets and transactions','organization'],['liquidity','السيولة والبنوك','Cash and banks','bank'],['budgets','الموازنات والتخطيط','Budgets and planning','calendar'],['vat','الفواتير والضريبة','Invoices and VAT','regulatory'],['zakat','الزكاة والتقييمات','Zakat and assessments','finance'],['debts','الديون والعقود والتمويل','Debts and financing','opening'],['investments','الاستثمارات والمشاركات','Investments','chart']].map(([key,name_ar,name_en,icon])=>({key,name_ar,name_en,icon,description_ar:'إدارة البيانات ومتابعة العمليات والتقارير.',description_en:'Manage data, transactions and reporting.',pricing:key==='budgets'?'quote':'fixed',monthly:key==='budgets'?null:10.25,yearly:key==='budgets'?null:100,currency:'SAR',published:true,revision:1,requires:['assets','liquidity'].includes(key)?[]:['assets','liquidity']}));
 let rows=[],submission;
 const route=async route=>{const req=route.request();if(req.method()==='POST'){submission=req.postDataJSON();assert.equal(submission.organization_id,organizationId);assert.equal(submission.action,'submit');rows=[{id:'test-request',request_number:1,organization_id:organizationId,items:modules.filter(m=>submission.modules.some(s=>s.key===m.key)),billing_interval:submission.interval,currency:'SAR',total:null,max_users:5,status:'pending',revision:1,phone:'',notes:'',created_at:new Date().toISOString()}];await route.fulfill({status:200,json:rows[0]});}else await route.fulfill({status:200,json:{modules,rows,can_request:true,max_users:5}});};
 await page.route('**/api/subscriptions/bundles?*',route);await page.route('**/api/subscriptions/bundles',route);
 await page.locator('.yb-billing-tabs').getByRole('button',{name:ar?'صمّم باقتك':'Build your bundle',exact:true}).click();
 await page.locator('[data-module="budgets"] button').waitFor();
 assert.match(await page.locator('.bundle-total').innerText(),/20[.,]50/);
 await page.locator('[data-module="budgets"] button').click();
 assert.match(await page.locator('.bundle-total').innerText(),ar?/بعد المراجعة/:/after review/);
 assert.equal(await page.locator('.bundle-card[data-selected=true]').count(),3);
 for(const width of [1490,390]){await page.setViewportSize({width,height:1050});await page.waitForTimeout(350);await page.evaluate(()=>document.fonts.ready);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Bundle viewport overflow');
 const icon=await page.locator('.bundle-card>.settings-icon').first().evaluate(el=>getComputedStyle(el).color);assert.equal(icon,'rgb(198, 163, 93)');
 assert.equal(await page.locator('.bundle-card[data-selected=true]').first().evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(255, 255, 255)');
 await page.screenshot({path:`${out}/bundle-${locale}-${width}.png`,fullPage:true});}
 await page.locator('.bundle-consent input').check();await page.locator('.bundle-summary .bundle-primary').click();
 await page.locator('.bundle-history article').waitFor();assert.equal(submission.modules.length,3);assert.match(submission.token,/^[0-9a-f-]{36}$/);
 assert.ok(await page.locator('.bundle-summary .bundle-primary').isDisabled());
 await page.unroute('**/api/subscriptions/bundles?*',route);await page.unroute('**/api/subscriptions/bundles',route);
 await page.setViewportSize({width:1490,height:1050});
}
