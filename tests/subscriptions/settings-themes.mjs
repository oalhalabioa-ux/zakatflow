import assert from 'node:assert/strict';

const palettes = {
  'yaqeen-business': { selected: 'rgb(198, 163, 93)', ink: 'rgb(15, 45, 74)', nav: 'rgb(16, 47, 75)' },
  classic: { selected: 'rgb(30, 100, 114)', ink: 'rgb(255, 255, 255)', nav: 'rgb(41, 63, 80)' },
  modern: { selected: 'rgb(67, 85, 199)', ink: 'rgb(255, 255, 255)', nav: 'rgb(41, 60, 143)' },
  elegant: { selected: 'rgb(13, 117, 95)', ink: 'rgb(255, 255, 255)', nav: 'rgb(25, 77, 66)' },
};
const contrast = ({fg,bg}) => {
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
const readColors = elements => elements.map(el=>{
  const style=getComputedStyle(el);
  let surface=el;
  while(surface.parentElement&&getComputedStyle(surface).backgroundColor==='rgba(0, 0, 0, 0)')surface=surface.parentElement;
  return {fg:style.color,bg:getComputedStyle(surface).backgroundColor};
});

export async function verifySettingsTheme({page,theme,org,appUrl,root}) {
  const expected=palettes[theme];
  for(const locale of ['ar','en'])for(const width of [390,1440]) {
    await page.setViewportSize({width,height:1000});
    for(const section of ['settings','billing','settings/system']) {
      await page.goto(`${appUrl}/${locale}/${section}?organization=${org}`);
      await page.locator('.corp-shell.theme-'+theme).waitFor();
      await page.locator('.settings-tabs a[aria-current=page]').waitFor();
      if(section==='billing')await page.locator('.pricing-card').first().waitFor();
      else await page.getByLabel(locale==='ar'?'اسم المؤسسة':'Organization name',{exact:true}).waitFor();
      const active=await page.locator('.settings-tabs a[aria-current=page]').evaluateAll(readColors);
      assert.deepEqual(active,[{fg:expected.ink,bg:expected.selected}],`${theme} ${section} active tab`);
      assert.equal(await page.locator('.settings-tabs').evaluate(el=>getComputedStyle(el).backgroundColor),expected.nav);
      assert.ok(contrast(active[0])>=4.5,`${theme} selected tab contrast`);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${theme} ${locale} ${width} ${section} overflow`);
      if(theme!=='yaqeen-business') {
        const targets='.settings-card,.console-card,.subscription-summary,.settings-heading p,.settings-facts dt,.subscription-panel button:not(:disabled),.subscription-summary-actions a';
        const colors=await page.locator(targets).evaluateAll(readColors);
        for(const c of colors)assert.ok(contrast(c)>=4.5,`${theme} ${section} text contrast ${JSON.stringify(c)}`);
        if(section==='billing') {
          const interval=page.locator('.pricing-interval');
          const buttons=interval.locator('button');
          for(const index of [1,0]) {
            await buttons.nth(index).click();
            assert.equal(await buttons.nth(index).getAttribute('aria-pressed'),'true');
            const [selected]=await buttons.nth(index).evaluateAll(readColors);
            assert.deepEqual(selected,{fg:'rgb(255, 255, 255)',bg:expected.selected});
          }
        }
      }
      if(section==='settings/system') {
        await page.getByRole('button',{name:locale==='ar'?'إعداد الفوترة':'Configure invoicing',exact:true}).click();
        const dialog=page.locator('dialog[open].subscription-modal');await dialog.waitFor();
        if(theme!=='yaqeen-business') {
          const colors=await dialog.locator('.console-tabs button,input,select,textarea').evaluateAll(readColors);
          for(const c of colors)assert.ok(contrast(c)>=4.5,`${theme} dialog contrast ${JSON.stringify(c)}`);
        }
        const box=await dialog.boundingBox();assert.ok(box.x>=10&&box.x+box.width<=width-10,`${theme} dialog width`);
      }
      await page.screenshot({path:new URL(`tests/subscriptions/screenshots/settings-colors-${theme}-${locale}-${width}-${section.replaceAll('/','-')}.png`,root).pathname,fullPage:section!=='settings/system'});
      if(section==='settings/system')await page.keyboard.press('Escape');
    }
  }
  await page.goto(`${appUrl}/en/settings?organization=${org}`);
  await page.getByLabel('Organization name',{exact:true}).waitFor();
}
