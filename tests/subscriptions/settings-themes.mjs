import assert from 'node:assert/strict';
import {readdirSync} from 'node:fs';

const palettes = {
  'yaqeen-business': { selected: 'rgb(198, 163, 93)', ink: 'rgb(255, 255, 255)', nav: 'rgb(16, 47, 75)' },
  classic: { selected: 'rgb(30, 100, 114)', ink: 'rgb(255, 255, 255)', nav: 'rgb(41, 63, 80)' },
  modern: { selected: 'rgb(67, 85, 199)', ink: 'rgb(255, 255, 255)', nav: 'rgb(41, 60, 143)' },
  elegant: { selected: 'rgb(13, 117, 95)', ink: 'rgb(255, 255, 255)', nav: 'rgb(25, 77, 66)' },
};
export const contrast = ({fg,bg}) => {
  const lum = color => {
    // Chromium may serialize color-mix as color(srgb …).
    const channels = color.startsWith('color(srgb')
      ? color.slice(11).match(/[\d.]+/g).slice(0,3).map(Number)
      : color.match(/[\d.]+/g).slice(0,3).map(v=>Number(v)/255);
    const rgb=channels.map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
    return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;
  };
  const [a,b]=[lum(fg),lum(bg)].sort((a,b)=>b-a);
  return (a+.05)/(b+.05);
};
export const readColors = elements => elements.map(el=>{
  const style=getComputedStyle(el);
  let surface=el;
  while(surface.parentElement&&getComputedStyle(surface).backgroundColor==='rgba(0, 0, 0, 0)')surface=surface.parentElement;
  return {fg:style.color,bg:getComputedStyle(surface).backgroundColor};
});

const separateRouteFixtures = new Map([
  ['admin','redirects to the owner console'],
  ['assessments/[id]','requires a saved Zakat assessment'],
  ['cash-vouchers/[id]','requires an institutional cash voucher'],
  ['chart-of-accounts','requires Financial Opening Workspace'],
  ['dashboard/report','requires the full dashboard schema'],
  ['feasibility/shared','requires the sharing flag and team fixtures'],
  ['feasibility/shared/review','requires a study proposal and the sharing flag'],
  ['financial-events','requires Financial Budget QA'],
  ['financial-reporting-policy','requires live institutional statements'],
  ['login','uses the public sign-in identity'],
  ['login/invitation','uses the public invitation identity'],
  ['lots/[id]','requires a saved asset lot'],
  ['opening-balances','requires Financial Opening Workspace'],
  ['opening-balances/branches','requires the opening distribution fixtures'],
  ['opening-balances/centers','requires the opening distribution fixtures'],
  ['preview/fiscal-years','requires Fiscal Year Review Preview'],
  ['reports/print','uses the print identity'],
  ['transactions/[id]','requires a posted transaction'],
]);
const routeTargets = new Map([
  ['dashboard',['dashboard','onboarding']],
  ['invoice-register',['vat']],
  ['qard-loans',['loans']],
]);
const moduleControls = {
  assets:['.assets-page','--brand-muted'],
  transactions:['.transactions-page','--tx-muted'],
  liquidity:['.liquidity-page','--liq-muted'],
  vat:['.vat-page','--vat-muted'],
  'budget-planning':['.budget-plan','--brand-muted'],
  organizations:['.organizations-page','--org-muted'],
  prices:['.prices-page','--prices-green','accent'],
  'settings/financial/setup':['.financial-setup','--setup-gold','accent'],
};

function listWorkspaceRoutes(root) {
  return readdirSync(new URL('app/%5Blocale%5D/',root),{recursive:true})
    .filter(path=>path.endsWith('/page.tsx'))
    .map(path=>path.slice(0,-'/page.tsx'.length))
    .sort();
}

const reviewRoutes = new Set([
  'assessments','assets','assets/dashboard','budget-planning','governance','lots',
  'notifications','payments','reports','settings/team','transactions','users','workflow',
]);

async function verifyVisualFixes({page,workspace,route,theme,locale,width,root}) {
  if(reviewRoutes.has(route)) {
    const supportingText=workspace.locator('p.muted:visible');
    const colors=await supportingText.evaluateAll(readColors);
    for(const c of colors)assert.ok(contrast(c)>=4.5,`${route} supporting text: ${JSON.stringify(c)}`);
  }
  if(route==='organizations') {
    await workspace.locator('.orgs-entities-table tbody tr').first().waitFor();
    const scroll=await workspace.locator('.orgs-entities-table-wrap').evaluate(el=>({
      pageWidth:document.documentElement.scrollWidth,viewport:innerWidth,
      overflow:getComputedStyle(el).overflowX,wrapperWidth:el.clientWidth,tableWidth:el.scrollWidth,
    }));
    assert.ok(scroll.pageWidth<=scroll.viewport,`organization page scroll: ${JSON.stringify(scroll)}`);
    if(width===390)assert.ok(['auto','scroll'].includes(scroll.overflow)&&scroll.tableWidth>scroll.wrapperWidth);
  }
  if(route==='workflow') {
    const ar=locale==='ar';
    const flow=workspace.locator('.review-workflow');
    await flow.getByRole('heading',{level:1,name:ar?'دورة المراجعة والاعتماد':'Review and approval workflow',exact:true}).waitFor();
    const step=flow.locator('[aria-current=step]');
    assert.equal(await step.innerText(),ar?'المراجعة المحاسبية':'Accounting review');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'workflow page scroll');
    assert.ok(contrast((await step.evaluateAll(readColors))[0])>=4.5,'active workflow step contrast');
    await flow.getByRole('button',{name:ar?'انتقال إلى المراجعة الشرعية':'Move to Sharia review',exact:true}).click();
    assert.equal(await step.innerText(),ar?'المراجعة الشرعية':'Sharia review');
  }
  if(['organizations','workflow','reports','notifications'].includes(route)) {
    await page.screenshot({path:new URL(`tests/subscriptions/screenshots/after-${theme}-${route}-${locale}-${width}.png`,root).pathname});
  }
}

async function verifyOwnerConsole({page,theme,appUrl,root}) {
  for(const locale of ['ar','en'])for(const width of [390,1440]) {
    await page.setViewportSize({width,height:width===390?844:960});
    await page.goto(`${appUrl}/${locale}/admin`);
    const shell=page.locator('.owner-shell');
    await shell.locator('h1').waitFor();
    const label=locale==='ar'?(theme==='modern'?'العصري':'الأنيق'):(theme==='modern'?'Modern':'Elegant');
    await shell.locator('.owner-theme-picker').getByRole('button',{name:label,exact:true}).click();
    await page.locator(`html[data-owner-theme=${theme}]`).waitFor();
    const heading=await shell.locator('.owner-top h1').evaluateAll(readColors);
    assert.ok(contrast(heading[0])>=4.5,`owner dashboard heading: ${theme} ${locale} ${width}`);
    await page.screenshot({path:new URL(`tests/subscriptions/screenshots/owner-${theme}-${locale}-${width}.png`,root).pathname});
  }
}

async function verifyWorkspaceRoutes({page,theme,appUrl,root,org,modulePalette}) {
  const routes=listWorkspaceRoutes(root);
  for(const route of separateRouteFixtures.keys())assert.ok(routes.includes(route), `removed route fixture: ${route}`);
  const liveRoutes=routes.filter(route=>!separateRouteFixtures.has(route));
  const verifiedRoutes=[];
  const failures=[];
  for(const locale of ['ar','en'])for(const width of [390,1440]) {
    await page.setViewportSize({width,height:width===390?844:960});
    for(const route of liveRoutes) {
      const query=new URLSearchParams(route==='assets/dashboard'||route.startsWith('settings')
        ? {scope:'ORGANIZATION',organization:org} : {scope:'PERSONAL'});
      try {
        const response=await page.goto(`${appUrl}/${locale}/${route}?${query}`,{waitUntil:'domcontentloaded',timeout:12000});
        assert.ok(response?.ok(),`HTTP ${response?.status()}`);
        const actual=new URL(page.url()).pathname;
        assert.ok((routeTargets.get(route)??[route]).some(target=>actual===`/${locale}/${target}`),`redirected to ${actual}`);
        const workspace=page.locator(`.corp-shell.theme-${theme} .corp-content`);
        const [selector,token,paletteKey]=moduleControls[route]??['','--brand-muted','muted'];
        const module=selector?workspace.locator(selector):workspace;
        await module.waitFor({timeout:5000});
        const value=await module.evaluate((element,property)=>getComputedStyle(element).getPropertyValue(property).trim(),token);
        assert.equal(value,modulePalette[paletteKey??'muted'],token);
        await verifyVisualFixes({page,workspace,route,theme,locale,width,root});
        verifiedRoutes.push({locale,width,route,actual});
      } catch(error) {
        failures.push({locale,width,route,error:error.message.split('\n')[0]});
      }
    }
  }
  console.log('WORKSPACE_THEME_ROUTES '+JSON.stringify({theme,verifiedRoutes,failures,separateFixtures:[...separateRouteFixtures]}));
  assert.deepEqual(failures,[],`${theme} workspace route failures`);
}

async function verifyModulePalette({page,theme,appUrl,root,org}) {
  const modulePalettes={modern:{accent:'#4355c7',muted:'#586589'},elegant:{accent:'#0d755f',muted:'#536e64'}};
  const modulePalette=modulePalettes[theme];
  const sizes=modulePalette?[390,1440]:[1440];
  const locales=modulePalette?['ar','en']:['en'];
  for(const locale of locales)for(const width of sizes) {
    await page.setViewportSize({width,height:960});
    await page.goto(`${appUrl}/${locale}/financial-reports?scope=PERSONAL`);
    const workspace=page.locator(`.corp-shell.theme-${theme} .corp-content`);
    const reportTab=workspace.locator('.fs-personal-tabs [aria-selected=true]');
    await reportTab.waitFor();
    const [reportColor]=await reportTab.evaluateAll(readColors);
    assert.deepEqual(reportColor,modulePalette
      ? {fg:'rgb(255, 255, 255)',bg:palettes[theme].selected}
      : {fg:'rgb(16, 36, 58)',bg:'rgb(198, 163, 93)'},`${theme} personal report tab palette`);
    if(!modulePalette)continue;
    assert.ok(contrast(reportColor)>=4.5);
    const actionSurface=await workspace.evaluate(element=>getComputedStyle(element).getPropertyValue('--action-surface').trim());
    assert.equal(actionSurface,'#fff',`${theme} operation dialog surface`);
    await page.screenshot({path:new URL(`tests/subscriptions/screenshots/${theme}-reports-${locale}-${width}.png`,root).pathname});

    await page.goto(`${appUrl}/${locale}/feasibility?scope=PERSONAL`);
    const study=workspace.locator('.fs-page');
    await study.waitFor();
    const accent=await study.evaluate(element=>getComputedStyle(element).getPropertyValue('--fs-gold').trim());
    assert.equal(accent,modulePalette.accent,`${theme} ${locale} ${width} feasibility icon palette`);
    await page.screenshot({path:new URL(`tests/subscriptions/screenshots/${theme}-feasibility-${locale}-${width}.png`,root).pathname});
  }

  if(modulePalette)await verifyWorkspaceRoutes({page,theme,appUrl,root,org,modulePalette});
}

export async function verifySettingsTheme({page,theme,org,appUrl,root}) {
  const expected=palettes[theme];
  for(const locale of ['ar','en'])for(const width of [390,1440]) {
    await page.setViewportSize({width,height:1000});
    for(const section of ['settings','billing','settings/system','settings/regulatory']) {
      // This fixture verifies the six institutional settings areas. Shared
      // preferences keep that scope while remaining independent of a company.
      const query=new URLSearchParams({scope:'ORGANIZATION'});
      if(section!=='settings/system'){query.set('organization',org);query.set('level','COMPANY');}
      await page.goto(`${appUrl}/${locale}/${section}?${query}`);
      await page.locator('.corp-shell.theme-'+theme).waitFor();
      const selectedTab=section==='billing'?'.yb-billing-tabs button[aria-pressed=true]':'.settings-tabs a[aria-current=page]';
      await page.locator(selectedTab).waitFor();
      if(section==='billing')await page.locator('.yb-billing-tabs').waitFor();
      else if(section==='settings')await page.getByLabel(locale==='ar'?'اسم المؤسسة':'Organization name',{exact:true}).waitFor();
      else if(section==='settings/system')await page.locator('.yp-preferences-card').first().waitFor();
      else await page.locator('[data-regulatory-workspace]').waitFor();
      // Six settings areas, with independent billing outside
      // the main journey. Keep full readability checks rather than relying on
      // the old navy-bar palette, which belonged to the superseded design.
      assert.equal(await page.locator('.settings-tabs a').count(),section==='billing'?0:6);
      const active=await page.locator(selectedTab).evaluateAll(readColors);
      assert.equal(active.length,1,`${theme} ${section} active section must be unambiguous`);
      assert.ok(contrast(active[0])>=4.5,`${theme} ${section} selected tab contrast ${JSON.stringify(active[0])}`);
      if((theme==='modern'||theme==='elegant')&&section==='billing')
        assert.deepEqual(active[0],{fg:expected.ink,bg:expected.selected},`${theme} billing tab`);
      const primaryColors=await page.locator('.settings-tabs a').evaluateAll(readColors);
      for(const item of primaryColors)assert.ok(contrast(item)>=4.5,
        `${theme} ${section} primary navigation contrast ${JSON.stringify(item)}`);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${theme} ${locale} ${width} ${section} overflow`);
      if((theme==='modern'||theme==='elegant')&&section==='billing') {
        const planHeading=page.locator('.yb-plan-card h2');
        await planHeading.waitFor();
        assert.ok(contrast((await planHeading.evaluateAll(readColors))[0])>=4.5,`${theme} trial title contrast`);
        await page.screenshot({path:new URL(`tests/subscriptions/screenshots/after-${theme}-trial-${locale}-${width}.png`,root).pathname});
      }
      if(theme!=='yaqeen-business') {
        const targets='.settings-card,.console-card,.subscription-summary,.settings-heading p,.settings-facts dt,.subscription-panel button:not(:disabled),.subscription-summary-actions a';
        const colors=await page.locator(targets).evaluateAll(readColors);
        for(const c of colors)assert.ok(contrast(c)>=4.5,`${theme} ${section} text contrast ${JSON.stringify(c)}`);
        if(section==='billing') {
          // The default billing tab is a real subscription overview; pricing
          // intervals live only inside the separate Plans & upgrades tab.
          await page.locator('.yb-billing-tabs').getByRole('button',{
            name:locale==='ar'?'الباقات والترقية':'Plans & upgrades',exact:true,
          }).click();
          const interval=page.locator('.pricing-interval');
          await interval.waitFor();
          const buttons=interval.locator('button');
          for(const index of [1,0]) {
            await buttons.nth(index).click();
            assert.equal(await buttons.nth(index).getAttribute('aria-pressed'),'true');
            const [selected]=await buttons.nth(index).evaluateAll(readColors);
            assert.deepEqual(selected,{fg:'rgb(255, 255, 255)',bg:expected.selected});
          }
        }
      }
      // ZATCA is part of the legal/tax tab, not global system preferences.
      if(section==='settings/regulatory') {
        await page.getByRole('button',{name:locale==='ar'?'التسجيل الضريبي':'Tax registration',exact:true}).click();
        const dialog=page.locator('.financial-setup-regulatory-editor');await dialog.waitFor();
        if((theme==='modern'||theme==='elegant')&&section==='billing') {
        const planHeading=page.locator('.yb-plan-card h2');
        await planHeading.waitFor();
        assert.ok(contrast((await planHeading.evaluateAll(readColors))[0])>=4.5,`${theme} trial title contrast`);
        await page.screenshot({path:new URL(`tests/subscriptions/screenshots/after-${theme}-trial-${locale}-${width}.png`,root).pathname});
      }
      if(theme!=='yaqeen-business') {
          const colors=await dialog.locator('.console-tabs button,input,select,textarea').evaluateAll(readColors);
          for(const c of colors)assert.ok(contrast(c)>=4.5,`${theme} dialog contrast ${JSON.stringify(c)}`);
        }
        const box=await dialog.boundingBox();assert.ok(box.x>=10&&box.x+box.width<=width-10,`${theme} dialog width`);
      }
      await page.screenshot({path:new URL(`tests/subscriptions/screenshots/settings-colors-${theme}-${locale}-${width}-${section.replaceAll('/','-')}.png`,root).pathname,fullPage:section!=='settings/regulatory'});
      if(section==='settings/regulatory')await page.keyboard.press('Escape');
    }
  }
  await verifyModulePalette({page,theme,appUrl,root,org});
  if(theme==='modern'||theme==='elegant')await verifyOwnerConsole({page,theme,appUrl,root});
  await page.goto(`${appUrl}/en/settings?organization=${org}`);
  await page.getByLabel('Organization name',{exact:true}).waitFor();
}
