// Read-only local-browser UI evidence. No hosted deployment or institution writes.
import assert from 'node:assert/strict';
const routes=['settings/financial/setup','settings','settings/regulatory','settings/financial','settings/team','settings/system','billing'];
export async function verifySettingsNavigationRefinement({page,app,orgId,out}){
 for(const locale of ['ar','en']){
  const ar=locale==='ar';
  await page.setViewportSize({width:1490,height:1050});
  await page.goto(`${app}/${locale}/settings/financial?organization=${orgId}`);
  await page.locator('[data-financial-overview-ready=true]').waitFor();
  const sidebar=page.locator('#corp-settings-nav');
  await sidebar.waitFor();
  assert.deepEqual(await sidebar.locator('a').evaluateAll(links=>links.map(a=>new URL(a.href).pathname.split('/').slice(2).join('/'))),routes,'Sidebar mirrors settings order and includes all seven destinations');
  assert.equal(await sidebar.locator('a[aria-current=page]').count(),1);
  assert.equal(await sidebar.locator('a').last().innerText(),ar?'الاشتراك والباقات':'Subscription & plans');
  const finance=page.locator('.settings-finance-journey-tabs');
  await finance.getByRole('button',{name:ar?'دليل الحسابات':'Chart of accounts',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.settings-finance-journey-tabs button[aria-pressed=true]')?.textContent?.match(/دليل الحسابات|Chart of accounts/));
  const colors=await finance.locator('button[aria-pressed=true]').evaluate(el=>({background:getComputedStyle(el).backgroundColor,text:getComputedStyle(el).color,icon:getComputedStyle(el.querySelector('svg')).color}));
  assert.deepEqual(colors,{background:'rgb(29, 56, 82)',text:'rgb(216, 184, 117)',icon:'rgb(216, 184, 117)'},'Only selected finance tab uses the lighter navy and gold');
  const primary=page.locator('.settings-tabs');
  for(const width of [1490,390]){
   await page.setViewportSize({width,height:1050});
   await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(450);
   const geometry=await primary.evaluate(nav=>{
    const axis=(el,pseudo)=>{
     const r=el.getBoundingClientRect(),own=getComputedStyle(el),style=getComputedStyle(el,pseudo);
     const translate=style.transform==='none'?0:new DOMMatrixReadOnly(style.transform).m42;
     return r.bottom-parseFloat(own.borderBottomWidth)-parseFloat(style.bottom)-parseFloat(style.height)/2+translate;
    };
    return {railVisible:getComputedStyle(nav,'::before').display!=='none',rail:axis(nav,'::before'),items:[...nav.querySelectorAll('a')].map(a=>({dot:axis(a,'::after'),segment:axis(a,'::before')}))};
   });
   assert.equal(geometry.items.length,6);
   for(const item of geometry.items){
    assert.ok(Math.abs(item.dot-item.segment)<1,'Green/grey segment crosses marker center');
    if(geometry.railVisible)assert.ok(Math.abs(item.dot-geometry.rail)<1,`Silver baseline crosses every marker center: ${JSON.stringify(geometry)}`);
   }
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Navigation refinements do not overflow the page');
   if(out){
    await primary.screenshot({path:`${out}/settings-refined-stepper-${locale}-${width}.png`});
    await finance.screenshot({path:`${out}/settings-refined-financial-tabs-${locale}-${width}.png`});
   }
   if(width===1490){
    const journey=primary.locator('a[href*="/settings/financial/setup"]');
    await page.mouse.move(0,0);
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('.settings-tabs a[href*="/settings/financial/setup"] svg')).color==='rgb(198, 163, 93)');
    await journey.hover();
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('.settings-tabs a[href*="/settings/financial/setup"] svg')).color==='rgb(32, 83, 71)');
    if(out)await primary.screenshot({path:`${out}/settings-refined-hover-${locale}-${width}.png`});
    await page.mouse.move(0,0);
    if(out)await sidebar.screenshot({path:`${out}/settings-refined-sidebar-${locale}-${width}.png`});
   }else{
    await page.locator('.corp-mobile-menu').click();
    await page.locator('.corp-drawer-close').click();
    await page.waitForFunction(()=>document.querySelector('.corp-shell')?.classList.contains('sidebar-mobile-open')&&!document.querySelector('.corp-shell')?.classList.contains('sidebar-mobile-rail'));
    assert.equal(await sidebar.locator('a').count(),7);
    if(out)await sidebar.screenshot({path:`${out}/settings-refined-sidebar-${locale}-${width}.png`});
    await page.locator('.corp-drawer-close').click();
   }
  }
  await page.setViewportSize({width:1490,height:1050});
  for(const destination of ['settings/regulatory','settings/team','settings/system','billing']){
   await page.goto(`${app}/${locale}/${destination}?organization=${orgId}`);
   const selected=page.locator('#corp-settings-nav a[aria-current=page]');await selected.waitFor();
   assert.equal(await selected.count(),1,'Exactly one sidebar section active');
   assert.equal(await selected.evaluate(a=>new URL(a.href).pathname),`/${locale}/${destination}`,'Tax, team, system and subscription select their own destinations');
  }
 }
}
