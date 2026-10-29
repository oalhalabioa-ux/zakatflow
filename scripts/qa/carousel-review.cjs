const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const {chromium} = require('playwright');

const out = path.resolve('artifacts/carousel-review');
fs.mkdirSync(out, {recursive: true});
const checks = [];
const layouts = {};
const titles = {
  en: ['A clearer cash position', 'Budgets for decisions', 'Connected assets & zakat', 'Trackable balances'],
  ar: ['رؤية أوضح للسيولة', 'موازنة تدعم القرار', 'أصول وزكاة مترابطة', 'ذمم قابلة للمتابعة'],
};
const copy = {
  en: [
    ['Track available cash and upcoming payments, then open the related transaction at its source.', 'Cash & liquidity'],
    ['Compare budgets, actual results and forecasts before reallocating resources.', 'Financial planning'],
    ['Follow asset costs, valuations, holding periods, zakat calculations and payments in one clear workflow.', 'Assets & zakat'],
    ['Review installments, payments and outstanding balances, then open the original voucher.', 'Balances & financing'],
  ],
  ar: [
    ['تابع النقد المتاح والاستحقاقات القادمة، ثم افتح العملية المرتبطة من مصدرها.', 'السيولة والتدفقات'],
    ['راجع الموازنة والفعلي والتوقعات قبل إعادة توزيع الموارد.', 'التخطيط المالي'],
    ['تابع تكلفة الأصل وقيمته والحول والاحتساب والدفعات في مسار واضح.', 'الأصول والزكاة'],
    ['راجع الأقساط والسداد والمتبقي، وانتقل إلى السند الأصلي.', 'الذمم والتمويل'],
  ],
};
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const serverLog = fs.openSync(path.join(out, 'server.log'), 'w');
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', '3180'], {
  env: {...process.env, NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'isolated-carousel-placeholder'},
  stdio: ['ignore', serverLog, serverLog],
});
const pass = (name, details = {}) => {checks.push({name, pass: true, ...details}); console.log('PASS', name, JSON.stringify(details));};

async function open(page, version, lang) {
  const route = version === 'before' ? '/design-review/carousel-before' : '/';
  await page.goto(`http://127.0.0.1:3180${route}?lang=${lang}#usecases`, {waitUntil: 'networkidle'});
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map(image => image.decode().catch(() => {})));
  });
  await page.locator('#usecases').scrollIntoViewIfNeeded();
  await page.evaluate(() => document.querySelector('#usecases').scrollIntoView({block: 'start'}));
  await delay(100);
}

async function card(page, lang, index) {
  await page.waitForFunction(({title}) => document.querySelector('#usecases article h3')?.textContent === title, {title: titles[lang][index]});
  const actual = await page.locator('#usecases article').first().evaluate(el => ({title: el.querySelector('h3').textContent, description: el.querySelector('p').textContent, category: el.querySelector('b').textContent}));
  assert.deepEqual(actual, {title: titles[lang][index], description: copy[lang][index][0], category: copy[lang][index][1]});
}

async function geometry(page) {
  return page.evaluate(() => {
    const box = el => {const r = el.getBoundingClientRect(); return {x: r.x, y: r.y + scrollY, width: r.width, height: r.height};};
    const first = document.querySelector('#usecases article');
    const style = getComputedStyle(first);
    return {
      viewport: {width: innerWidth, height: innerHeight},
      documentWidth: document.documentElement.scrollWidth,
      visibleCards: [...document.querySelectorAll('#usecases article')].filter(el => getComputedStyle(el).display !== 'none').length,
      card: box(first),
      cardStyle: {padding: style.padding, borderRadius: style.borderRadius, minHeight: style.minHeight, titleFont: getComputedStyle(first.querySelector('h3')).fontSize, bodyFont: getComputedStyle(first.querySelector('p')).fontSize},
      sections: Object.fromEntries(['.yb-hero', '#modules', '#solutions', '#sectors', '#features', '#usecases', '#footer'].map(selector => [selector, box(document.querySelector(selector))])),
    };
  });
}

async function swipe(page, dx, dy, kind = 'normal') {
  await page.evaluate(() => document.querySelector('#usecases').scrollIntoView({block: 'start'}));
  const target = await page.locator('#usecases .yq-stories>div').boundingBox();
  const x = target.x + target.width / 2, y = target.y + target.height / 2;
  const client = await page.context().newCDPSession(page);
  const point = (cx, cy, id = 1) => ({x: cx, y: cy, id, radiusX: 2, radiusY: 2, force: 1});
  const start = [point(x, y)];
  if (kind === 'multi') start.push(point(x + 25, y + 25, 2));
  await client.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: start});
  for (let i = 1; i <= 6; i++) {
    const points = [point(x + dx * i / 6, y + dy * i / 6)];
    if (kind === 'multi') points.push(point(x + 25 + dx * i / 6, y + 25 + dy * i / 6, 2));
    await client.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: points});
    await delay(20);
  }
  await client.send('Input.dispatchTouchEvent', {type: kind === 'cancel' ? 'touchCancel' : 'touchEnd', touchPoints: []});
  await client.detach();
  await delay(150);
}

(async () => {
  let browser;
  try {
    for (let i = 0; i < 100; i++) {
      try {if ((await fetch('http://127.0.0.1:3180/robots.txt')).ok) break;} catch {}
      if (server.exitCode !== null) throw Error('Local application server exited');
      await delay(200);
    }
    const executablePath = process.env.CHROME_BIN || ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'].find(file => fs.existsSync(file));
    browser = await chromium.launch({headless: true, ...(executablePath ? {executablePath} : {}), args: ['--no-sandbox']});
    for (const viewport of [{name: 'desktop', width: 1363, height: 936}, {name: 'mobile', width: 390, height: 844}, {name: 'mobile-360', width: 360, height: 800}]) {
      const mobile = viewport.width < 760;
      const context = await browser.newContext({viewport: {width: viewport.width, height: viewport.height}, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile});
      const page = await context.newPage();
      for (const version of ['before', 'after']) {
        await open(page, version, 'en');
        const layout = await geometry(page);
        assert.equal(layout.visibleCards, mobile ? 1 : 3);
        assert.ok(layout.documentWidth <= viewport.width, 'Horizontal overflow');
        layouts[`${viewport.name}-${version}`] = layout;
        if (viewport.name !== 'mobile-360') {
          await page.locator('#usecases').screenshot({path: path.join(out, `${viewport.name}-${version}.jpg`), type: 'jpeg', quality: 90, animations: 'disabled'});
          await page.screenshot({path: path.join(out, `${viewport.name}-${version}-full.jpg`), type: 'jpeg', quality: 85, fullPage: true, animations: 'disabled'});
        }
      }
      const before = layouts[`${viewport.name}-before`], after = layouts[`${viewport.name}-after`];
      assert.deepEqual(after, before, 'Layout differs from the historical baseline at '+viewport.name);
      pass(viewport.name+' historical layout parity', {visibleCards: after.visibleCards, viewport: after.viewport});
      for (const lang of ['en', 'ar']) {
        await open(page, 'after', lang);
        await card(page, lang, 0);
        const next = page.getByRole('button', {name: lang === 'ar' ? 'التالي' : 'Next', exact: true});
        const previous = page.getByRole('button', {name: lang === 'ar' ? 'السابق' : 'Previous', exact: true});
        const activate = locator => mobile ? locator.tap() : locator.click();
        for (const index of [1, 2, 3, 0]) {await activate(next); await card(page, lang, index);}
        await activate(previous); await card(page, lang, 3);
        await activate(next); await card(page, lang, 0);
        pass(viewport.name+' '+lang+' arrow cycle and synchronized content');
        if (mobile) {
          const forward = lang === 'ar' ? 120 : -120;
          await swipe(page, forward, 0); await card(page, lang, 1);
          await swipe(page, -forward, 0); await card(page, lang, 0);
          await swipe(page, -forward, 0); await card(page, lang, 3);
          await swipe(page, forward, 0); await card(page, lang, 0);
          for (const [dx, dy, kind] of [[10, 0, 'normal'], [forward, 0, 'cancel'], [30, 0, 'multi']]) {
            await swipe(page, dx, dy, kind); await card(page, lang, 0);
          }
          await page.evaluate(() => document.querySelector('#usecases').scrollIntoView({block: 'start'}));
          const scrollBefore = await page.evaluate(() => scrollY);
          await swipe(page, 0, -140); await card(page, lang, 0);
          const scrollAfter = await page.evaluate(() => scrollY);
          assert.ok(Math.abs(scrollAfter-scrollBefore)>10, 'Vertical touch must still scroll the page');
          pass(viewport.name+' '+lang+' native touch swipe, wraparound, ignored gestures and vertical scrolling');
        }
      }
      await context.close();
    }
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({baseline: '326536a6dd20c4b96841180bca6b9fa7ee81c9b1', checks, layouts, completed: true}, null, 2));
  } catch (error) {
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({checks, layouts, completed: false, error: String(error)}, null, 2));
    throw error;
  } finally {if (browser) await browser.close(); server.kill('SIGTERM'); fs.closeSync(serverLog);}
})().catch(error => {console.error(error); process.exitCode = 1;});
