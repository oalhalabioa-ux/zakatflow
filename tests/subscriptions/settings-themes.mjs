import assert from 'node:assert/strict';
import {readdirSync, writeFileSync} from 'node:fs';

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

async function verifyWorkspaceRoutes({page,theme,appUrl,root,org,modulePalette}) {
  const routes=listWorkspaceRoutes(root);
  for(const route of separateRouteFixtures.keys())assert.ok(routes.includes(route), `removed route fixture: ${route}`);
  const liveRoutes=routes.filter(route=>!separateRouteFixtures.has(route));
  const verifiedRoutes=[];
  const failures=[];
  const evidenceRoutes=new Set(['dashboard','assets','transactions','feasibility','financial-reports','liquidity','vat','budget-planning','settings']);
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
        await page.evaluate(() => document.fonts.ready);
        const layout=await workspace.evaluate(inspectViewport);
        verifiedRoutes.push({locale,width,route,actual,...layout});
        if(evidenceRoutes.has(route)||layout.documentOverflow>4||layout.repeatedUnwrappedText.length) {
          const name=route.replaceAll('/','-');
          await page.screenshot({path:new URL(`tests/subscriptions/screenshots/audit-${theme}-${locale}-${width}-${name}.png`,root).pathname,timeout:10000,animations:'disabled'});
        }
      } catch(error) {
        failures.push({locale,width,route,error:error.message.split('\n')[0]});
      }
    }
  }
  const result={theme,verifiedRoutes,failures,separateFixtures:[...separateRouteFixtures]};
  writeFileSync(new URL(`tests/subscriptions/theme-${theme}-audit-result.json`,root),JSON.stringify(result,null,2));
  console.log('THEME_AUDIT_SUMMARY '+JSON.stringify({theme,cases:verifiedRoutes.length,failures,viewportFindings:verifiedRoutes.filter(x=>x.documentOverflow>4||x.repeatedUnwrappedText.length).map(({route,locale,width,documentOverflow,repeatedUnwrappedText})=>({route,locale,width,documentOverflow,repeatedUnwrappedText})),contrastFindings:verifiedRoutes.filter(x=>x.lowContrast.length).map(({route,locale,width,lowContrast})=>({route,locale,width,lowContrast}))}));
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
      await page.goto(`${appUrl}/${locale}/${section}?organization=${org}`);
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
  await page.goto(`${appUrl}/en/settings?organization=${org}`);
  await page.getByLabel('Organization name',{exact:true}).waitFor();
}
export function inspectViewport(workspace) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d', {willReadFrequently:true});
  const cache = new Map();
  const rgba = color => {
    if (cache.has(color)) return cache.get(color);
    ctx.clearRect(0,0,1,1);
    ctx.fillStyle = color;
    ctx.fillRect(0,0,1,1);
    const [r,g,b,a] = ctx.getImageData(0,0,1,1).data;
    const result = [r/255,g/255,b/255,a/255];
    cache.set(color,result);
    return result;
  };
  const composite = (top,bottom) => {
    const alpha = top[3] + bottom[3]*(1-top[3]);
    if (!alpha) return [0,0,0,0];
    return top.slice(0,3).map((value,index)=>(value*top[3]+bottom[index]*bottom[3]*(1-top[3]))/alpha).concat(alpha);
  };
  const luminance = ([r,g,b]) => {
    const linear = value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4;
    return .2126*linear(r)+.7152*linear(g)+.0722*linear(b);
  };
  const background = element => {
    let accumulated = [0,0,0,0];
    for (let current=element;current;current=current.parentElement) {
      const style=getComputedStyle(current);
      if (style.backgroundImage!=='none'||Number(style.opacity)<1) return null;
      if (style.backgroundColor!=='rgba(0, 0, 0, 0)') {
        accumulated=composite(accumulated,rgba(style.backgroundColor));
        if (accumulated[3]>=.999) return accumulated;
      }
    }
    return composite(accumulated,[1,1,1,1]);
  };
  const label = element => element.innerText.trim().replace(/\s+/g,' ').slice(0,85);
  const visible = element => {
    const rect=element.getBoundingClientRect();
    return rect.width>0 && rect.height>0 && rect.right>0 && rect.left<innerWidth && rect.bottom>0 && rect.top<innerHeight && getComputedStyle(element).visibility==='visible';
  };
  const lowContrast=[];
  const repeatedUnwrappedText=[];
  const scanned=new Set();
  for (const element of workspace.querySelectorAll('h1,h2,h3,h4,p,button,a,label,th,summary')) {
    if (!visible(element)||element.closest('[disabled],[aria-disabled=true],[aria-hidden=true]')) continue;
    const text=label(element);
    if (!text||!Array.from(element.childNodes).some(node=>node.nodeType===Node.TEXT_NODE&&node.textContent.trim())) continue;
    const style=getComputedStyle(element);
    const key=element.tagName+'|'+text;
    if (scanned.has(key)) continue;
    scanned.add(key);
    const surface=background(element);
    if (surface) {
      const foreground=composite(rgba(style.color),surface);
      const [max,min]=[luminance(foreground),luminance(surface)].sort((a,b)=>b-a);
      const ratio=(max+.05)/(min+.05);
      const isLarge=parseFloat(style.fontSize)>=24||(parseFloat(style.fontSize)>=18.66&&Number(style.fontWeight)>=700);
      if (ratio+0.08<(isLarge?3:4.5)&&lowContrast.length<5)
        lowContrast.push({tag:element.tagName,text,ratio:Number(ratio.toFixed(2)),color:style.color,background:surface.slice(0,3).map(n=>Math.round(n*255))});
    }
    if (element.clientWidth>0 && element.scrollWidth-element.clientWidth>8 && style.textOverflow!=='ellipsis' && !element.closest('table, [role=tablist]') && repeatedUnwrappedText.length<5)
      repeatedUnwrappedText.push({tag:element.tagName,text,pixels:element.scrollWidth-element.clientWidth});
  }
  return {documentOverflow:Math.max(document.documentElement.scrollWidth,document.body.scrollWidth)-innerWidth,lowContrast,repeatedUnwrappedText,heading:workspace.querySelector('h1')?.innerText.trim()??null};
}
