// Real authenticated owner pages against the disposable stack; no API mocking.
import assert from 'node:assert/strict';
const palettes={yaqeen:'rgb(241, 244, 248)',elegant:'rgb(244, 247, 246)',modern:'rgb(245, 247, 255)',classic:'rgb(241, 245, 247)'};
const luminance=color=>{const c=color.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return c[0]*.2126+c[1]*.7152+c[2]*.0722;};
export async function ownerVisuals({browser,cookies,appUrl,root}){
 const context=await browser.newContext({viewport:{width:1366,height:900},deviceScaleFactor:1.5});
 await context.addCookies(cookies.map(c=>({name:c.name,value:c.value,url:appUrl})));
 await context.addInitScript(()=>localStorage.setItem('yaqeen-owner-sidebar','collapsed'));
 const page=await context.newPage();
 for(const locale of ['ar','en']){
  const ar=locale==='ar';await page.goto(appUrl+'/admin/subscriptions?lang='+locale);
  for(const [theme,label] of [['yaqeen',ar?'يقين الأساسي':'Yaqeen'],['elegant',ar?'الأنيق':'Elegant'],['modern',ar?'العصري':'Modern'],['classic',ar?'الكلاسيكي':'Classic']]){
   await page.getByRole('button',{name:label,exact:true}).click();await page.waitForFunction(theme=>document.documentElement.dataset.ownerTheme===theme,theme);
   assert.equal(await page.locator('.owner-shell').evaluate(e=>getComputedStyle(e).backgroundColor),palettes[theme]);
   const nav=page.getByRole('navigation',{name:ar?'إدارة الاشتراكات':'Subscription management'});
   for(const tab of [ar?'اشتراكات المؤسسات':'Organization subscriptions',ar?'طلبات التفعيل':'Activation requests']){
    await nav.getByRole('button',{name:tab,exact:true}).click();
    if(tab===(ar?'اشتراكات المؤسسات':'Organization subscriptions')){
     await page.locator('.owner-institution-table tbody tr').first().waitFor();await page.locator('.institution-detail .owner-member').first().waitFor();
     assert.equal(await page.locator('.institution-detail select').count(),0,'Mutation forms belong in a dialog, not the detail overview');
    }else{await page.locator('.owner-requests-table tbody tr').first().waitFor();await page.locator('.owner-request-detail .owner-decision-form').waitFor();}
    const navBox=await nav.boundingBox();assert.ok(navBox.height<=58,'Desktop subnavigation must remain compact');
    const widths=await nav.locator('button').evaluateAll(items=>items.map(e=>e.getBoundingClientRect().width));assert.ok(Math.max(...widths)-Math.min(...widths)<2,'Subnavigation fills evenly');
    const split=page.locator('.owner-subscription-console .console-split').first(),first=await split.locator(':scope > :first-child').boundingBox(),second=await split.locator(':scope > :last-child').boundingBox();
    assert.ok(ar?first.x>second.x:first.x<second.x,'Register/detail direction follows the active language');
    assert.ok(first.width>second.width,'The register has more room than the detail card');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const contacts=await page.locator('.owner-contact').evaluateAll(items=>items.map(e=>({dir:e.dir,whiteSpace:getComputedStyle(e).whiteSpace,overflow:getComputedStyle(e).textOverflow})));for(const c of contacts){assert.equal(c.dir,'ltr');assert.equal(c.whiteSpace,'nowrap');assert.equal(c.overflow,'ellipsis');}
    const surfaces=await page.locator('.owner-subscription-console .console-card,.owner-subscription-console .owner-console-tabs button').evaluateAll(items=>items.map(e=>({fg:getComputedStyle(e).color,bg:getComputedStyle(e).backgroundColor})));
    for(const c of surfaces){const l=[luminance(c.fg),luminance(c.bg)].sort((a,b)=>b-a);assert.ok((l[0]+.05)/(l[1]+.05)>=4.5,theme+' surface contrast '+JSON.stringify(c));}
    assert.ok(!/[٠-٩۰-۹]/.test(await page.locator('.owner-subscription-console').innerText()));
    const name=tab===(ar?'اشتراكات المؤسسات':'Organization subscriptions')?'institutions':'requests';await page.screenshot({path:new URL(`tests/subscriptions/screenshots/owner-${name}-${locale}-${theme}.png`,root).pathname,fullPage:true});
   }
  }
 }
 // Exercise the full range requested: small phones through large desktop monitors.
 await page.goto(appUrl+'/admin/subscriptions?lang=ar');
 for(const width of [320,360,390,768,1024,1920]){
  await page.setViewportSize({width,height:width<600?844:1000});
  for(const [id,label] of [['institutions','اشتراكات المؤسسات'],['requests','طلبات التفعيل']]){
   await page.getByRole('button',{name:label,exact:true}).click();await page.locator(id==='institutions'?'.owner-institution-table tbody tr':'.owner-requests-table tbody tr').first().waitFor();
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Outer overflow at '+width+' '+id);
   if(width<600){
    const table=page.locator(id==='institutions'?'.owner-institution-table':'.owner-requests-table');assert.equal(await table.evaluate(e=>getComputedStyle(e.querySelector('tbody tr')).display),'grid');
    assert.ok(await table.evaluate(e=>e.scrollWidth<=e.clientWidth+1),'Mobile records fit as cards');
    const contacts=await table.locator('td[data-label]').count();assert.ok(contacts>0,'Cards retain their field labels');
    const button=table.getByRole('button',{name:id==='institutions'?'إدارة':'عرض الطلب',exact:true}).first();await button.click();
    const detail=page.locator(id==='institutions'?'#owner-institution-details':'#owner-activation-details');await detail.waitFor();assert.ok((await detail.boundingBox()).width<=width-20);
   }
   if([320,768,1920].includes(width))await page.screenshot({path:new URL(`tests/subscriptions/screenshots/owner-${id}-ar-${width}.png`,root).pathname,fullPage:true});
  }
 }
 await context.close();
}
