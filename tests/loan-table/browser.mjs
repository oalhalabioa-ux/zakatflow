// Presentation-only fixture: no credentials, network APIs or database access.
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const {build}=await import(pathToFileURL(process.env.LOAN_TABLE_ESBUILD_MODULE).href);
const {chromium}=await import(pathToFileURL(process.env.LOAN_TABLE_BROWSER_MODULE).href);
const out=resolve(tmpdir(),'yaqeen-loan-table-browser');await mkdir(out,{recursive:true});
await build({entryPoints:['tests/loan-table/fixture.tsx'],bundle:true,outdir:out,entryNames:'fixture',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'public-assets',setup(build){build.onResolve({filter:/.*/},args=>args.kind==='url-token'?{path:args.path,external:true}:undefined);}}]});
const html='<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body style="margin:0"><div id="root"></div><script src="/fixture.js"></script></body></html>';
const server=createServer(async(req,res)=>{const name=new URL(req.url,'http://localhost').pathname;if(name==='/'){res.setHeader('content-type','text/html');res.end(html);return;}if(!['/fixture.css','/fixture.js'].includes(name)){res.statusCode=404;res.end();return;}res.setHeader('content-type',name.endsWith('.css')?'text/css':'text/javascript');res.end(await readFile(join(out,name.slice(1))));});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true});const errors=[];
await mkdir('tests/loan-table/screenshots',{recursive:true});
try{
for(const locale of ['ar','en'])for(const theme of ['yaqeen-business','classic','modern','elegant'])for(const width of [390,1440]){
  const context=await browser.newContext({viewport:{width,height:1000},isMobile:width===390,hasTouch:width===390});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>r.request().url().startsWith(url)?r.continue():r.abort());
  await page.goto(`${url}/?locale=${locale}&theme=${theme}`);const table=page.getByRole('table');await table.waitFor();
  assert.equal(await table.locator('th').count(),12,'No dedicated options column');
  const trigger=page.getByRole('button',{name:locale==='ar'?'خيارات أعمدة الجدول':'Table column options',exact:true});
  assert.equal(await trigger.evaluate(el=>el.parentElement.tagName),'TH');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Page must not overflow');
  const header=key=>table.locator(`[data-loan-header="${key}"]`),first=()=>table.locator('tbody tr').first().getAttribute('data-contract-id');
  assert.ok(await table.locator('col[data-loan-column=party]').evaluate(el=>el.getBoundingClientRect().width)>=280);
  assert.ok(await table.locator('col[data-loan-column=description]').evaluate(el=>el.getBoundingClientRect().width)>=350);
  const party=table.locator('[data-loan-cell=party]').first();assert.equal(await party.evaluate(el=>getComputedStyle(el).whiteSpace),'nowrap');
  await header('principal').locator('.loan-table-sort').click();assert.equal(await first(),'contract-34');
  await header('principal').locator('.loan-table-sort').click();assert.equal(await first(),'contract-0');
  await page.getByRole('button',{name:'Next',exact:true}).click();assert.equal(await first(),'contract-20','Sort must include records beyond the first page');
  await header('principal').locator('.loan-table-sort').click();assert.equal(await page.locator('[data-page]').textContent(),'1');assert.equal(await first(),'contract-34');
  const scroll=page.locator('.loan-configurable-table');await scroll.evaluate((el,locale)=>{el.scrollLeft=locale==='ar'?0:0;},locale);
  const resize=header('party').getByRole('separator');await resize.scrollIntoViewIfNeeded();const initial=Number(await resize.getAttribute('aria-valuenow'));
  if(width===1440){const b=await resize.boundingBox();await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2+(locale==='ar'?-90:90),b.y+b.height/2,{steps:8});await page.mouse.up();}
  else{const b=await resize.boundingBox(),client=await context.newCDPSession(page),x=b.x+b.width/2,y=b.y+b.height/2;await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+(locale==='ar'?-60:60),y}]});await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
  assert.ok(Number(await resize.getAttribute('aria-valuenow'))>initial,'Pointer/touch resize must grow the column');
  assert.equal(await header('principal').getAttribute('aria-sort'),'ascending','Resize must not sort');
  await resize.focus();await page.keyboard.press(locale==='ar'?'ArrowLeft':'ArrowRight');assert.ok(Number(await resize.getAttribute('aria-valuenow'))>initial+60);
  await trigger.click();const menu=page.getByRole('group',{name:locale==='ar'?'أعمدة جدول القروض':'Loan table columns',exact:true});await menu.waitFor();
  assert.equal(await menu.getByRole('checkbox').count(),12);
  const box=await menu.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width&&box.y>=0&&box.y+box.height<=1000,'Menu fits viewport');
  await menu.getByLabel(locale==='ar'?'البيان':'Description',{exact:true}).uncheck();assert.equal(await header('description').count(),0);assert.equal(await table.locator('tbody tr').first().locator('td').count(),11);
  await menu.getByLabel(locale==='ar'?'الجهة':'Counterparty',{exact:true}).uncheck();assert.equal(await trigger.evaluate(el=>el.parentElement.getAttribute('data-loan-header')),'type');
  await menu.getByLabel(locale==='ar'?'الجهة':'Counterparty',{exact:true}).check();await menu.getByLabel(locale==='ar'?'البيان':'Description',{exact:true}).check();
  assert.ok(Number(await header('party').getByRole('separator').getAttribute('aria-valuenow'))>initial,'Width survives visibility changes');
  await page.screenshot({path:`tests/loan-table/screenshots/${theme}-${locale}-${width}-menu.png`});
  await page.keyboard.press('Escape');assert.equal(await menu.count(),0);assert.ok(await trigger.evaluate(el=>el===document.activeElement));
  await header('due').locator('.loan-table-sort').click();assert.equal(await first(),'contract-1');
  await header('due').locator('.loan-table-sort').click();assert.equal(await first(),'contract-34');
  await table.locator('tbody tr').first().getByRole('button',{name:locale==='ar'?'التفاصيل والإجراءات':'Details and actions',exact:true}).click();assert.equal(await page.locator('[data-opened]').textContent(),'contract-34');
  await scroll.evaluate(el=>{el.scrollLeft=0;});
  await page.screenshot({path:`tests/loan-table/screenshots/${theme}-${locale}-${width}.png`});
  await context.close();console.log('PASS loan table',theme,locale,width);
}
assert.deepEqual(errors,[]);await writeFile('tests/loan-table/result.json',JSON.stringify({passed:16,browserErrors:errors,scenarios:['sort before pagination','null-last dates','pointer and touch resize','keyboard resize','column visibility','inline menu','row details','four themes','AR/EN','390/1440 viewport']},null,2));
}finally{await browser.close();server.close();}
