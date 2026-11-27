// Exercise the real onboarding component with deterministic API responses.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const {chromium} = await import(process.env.ASSET_BROWSER_MODULE);
const bundle = await build({
  stdin: {
    contents: `import {createRoot} from 'react-dom/client';
      import Tools from './components/AssessmentCycleStartTools';
      createRoot(document.querySelector('main')).render(<Tools ar={location.pathname.startsWith('/ar/')}/>);`,
    resolveDir: process.cwd(), loader: 'tsx'
  },
  jsx: 'automatic', bundle: true, write: false,
  define: {'process.env.NODE_ENV': '"production"'},
  plugins: [{name:'isolated-router',setup(builder) {
    builder.onResolve({filter:/^next\/navigation$/},()=>({path:'navigation',namespace:'fixture'}));
    builder.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const usePathname=()=>location.pathname;'}));
  }}]
});
const browser = await chromium.launch({headless:true});
try {
  for (const ar of [true,false]) {
    const page = await browser.newPage({viewport:{width:ar ? 390 : 1280,height:850}});
    const requests = [];
    await page.route('**/*',async route=>{
      const req=route.request(), url=new URL(req.url());
      if(url.pathname==='/bundle.js') return route.fulfill({contentType:'text/javascript',body:bundle.outputFiles[0].text});
      if(!url.pathname.startsWith('/api/')) return route.fulfill({contentType:'text/html',body:'<main></main><script src="/bundle.js"></script>'});
      if(req.method()==='GET') return route.fulfill({json:[]});
      requests.push(req.postDataJSON());
      return route.fulfill({json:{hawl_start_date:'2025-03-15',anchor_date:'2025-01-01',calendar:'GREGORIAN',cycles:[{cycle_no:1,historical:true,hawl_start_date:'2025-01-01',hawl_due_date:'2026-01-01'}]}});
    });
    await page.goto(`http://fixture.test/${ar?'ar':'en'}/assessments?scope=PERSONAL`);
    const method=page.getByRole('combobox').first();
    await method.selectOption('SETTLED_OPENING');
    await page.locator('input[type=date]').fill('2025-03-15');
    await page.locator('input[type=number]').last().fill('5');
    const start=page.getByRole('button').first();
    assert.ok(await start.isDisabled());
    await page.getByRole('checkbox').check();
    await Promise.all([page.waitForResponse('**/api/zakat-cycles/start'),start.click()]);
    assert.equal(requests.at(-1).settlement_confirmed,true);
    assert.equal(requests.at(-1).manual_date,'2025-03-15');
    await page.reload();
    await method.selectOption('HISTORICAL_RECORDED');
    await page.locator('input[type=number]').last().fill('5');
    await start.click();
    const choice=page.locator('tbody select');
    assert.equal(await choice.inputValue(),'');
    const apply=page.getByRole('button',{name:ar?'اعتماد البناء التاريخي':'Apply historical plan'});
    assert.ok(await apply.isDisabled());
    await choice.selectOption('DUE');
    assert.ok(await apply.isDisabled());
    await page.getByRole('checkbox').check();
    page.once('dialog',dialog=>dialog.accept());
    await Promise.all([page.waitForResponse('**/api/zakat-cycles/historical-plan'),apply.click()]);
    assert.equal(requests.at(-1).confirmed_anchor_date,'2025-01-01');
    assert.deepEqual(requests.at(-1).selections,{'1':'DUE'});
    await page.close();
  }
} finally {
  await browser.close();
}
