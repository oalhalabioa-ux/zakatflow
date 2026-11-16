const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES?process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright':'playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.PILOT_CHROMIUM_PATH?{executablePath:process.env.PILOT_CHROMIUM_PATH}:{}),args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
 const page=await browser.newPage({acceptDownloads:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const url=process.env.PILOT_URL||'file://'+path.resolve('../deliverables/Yaqeen_Financial_Reports_Pilot.html');
 const out='docs/financial-reports/evidence';fs.mkdirSync(out,{recursive:true});const results=[];
 const record=(name)=>{results.push({name,passed:true});console.log('PASS '+name)};
 for(const [w,h] of [[1672,941],[1440,900],[390,844],[375,812]]){
  await page.setViewportSize({width:w,height:h});await page.goto(url);await page.evaluate(()=>document.fonts.ready);
  assert.equal(await page.locator('.fr-metric').count(),5);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:`${out}/pilot-ar-${w}x${h}.png`,fullPage:true});record(`Arabic layout ${w}x${h}: 5 KPIs, no document overflow`);
 }
 await page.getByRole('button',{name:'فتح القائمة',exact:true}).click();assert.equal(await page.locator('.fr-sidebar').isVisible(),true);await page.getByRole('button',{name:'إغلاق القائمة',exact:true}).first().click();assert.equal(await page.locator('.fr-sidebar').isVisible(),false);record('Mobile drawer opens and closes');
 await page.setViewportSize({width:1672,height:941});await page.reload();
 await page.getByLabel('الفترة',{exact:true}).selectOption('3');assert.equal(await page.locator('.fr-bars>button').count(),3);
 let download=page.waitForEvent('download');await page.getByRole('button',{name:'تصدير التقرير',exact:true}).click();await page.getByRole('button',{name:'CSV',exact:true}).click();const csvDownload=await download;const csv=fs.readFileSync(await csvDownload.path(),'utf8');assert.equal(csv.split('\r\n').length,6);assert.match(csv,/2024-10/);assert.match(csv,/اصطناعية/);record('Period filter changes chart and CSV rows together');
 await page.getByLabel('المؤسسة التجريبية',{exact:true}).selectOption('demo-services');assert.match(await page.locator('.fr-metric').first().innerText(),/42.2/);record('Demo entity switch changes KPIs');
 download=page.waitForEvent('download');await page.getByRole('button',{name:'تصدير التقرير',exact:true}).click();await page.getByRole('button',{name:'Excel',exact:true}).click();const x=await download;const {Workbook}=require('exceljs');const wb=new Workbook();await wb.xlsx.readFile(await x.path());assert.equal(wb.worksheets[0].rowCount,5);assert.equal(wb.worksheets[0].getCell('B1').value,'demo-services');assert.equal(wb.worksheets[0].getCell('B5').value,120.5*.35);record('Real XLSX download matches selected entity and period');
 await page.getByRole('button',{name:'جدولة التقارير',exact:true}).click();await page.getByLabel('تكرار التقرير',{exact:true}).selectOption('monthly');await page.getByRole('button',{name:'تجربة الإعداد',exact:true}).click();assert.match(await page.getByRole('status').innerText(),/لم تُنشأ/);await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0);record('Schedule preview is local only; Escape closes dialog');
 await page.getByLabel('بحث في التقارير',{exact:true}).fill('not-a-report');assert.match(await page.getByRole('status').innerText(),/لا توجد/);await page.getByLabel('بحث في التقارير',{exact:true}).fill('');record('Search and empty result');
 await page.getByRole('button',{name:'العربية',exact:true}).click();assert.equal(await page.locator('.fr-pilot').getAttribute('dir'),'ltr');assert.match(await page.locator('h1').innerText(),/Financial reports/);
 for(const [w,h] of [[1672,941],[390,844]]){await page.setViewportSize({width:w,height:h});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:`${out}/pilot-en-${w}x${h}.png`,fullPage:true})}record('English LTR on desktop and mobile');
 await page.setViewportSize({width:1672,height:941});await page.reload();await page.pdf({path:`${out}/pilot-synthetic-print.pdf`,format:'A4',landscape:true,printBackground:true});record('Real print/PDF rendering');
 assert.equal(await page.evaluate(()=>/[٠-٩]/.test(document.querySelector('.fr-pilot').innerText)),false);assert.deepEqual(errors,[]);record('English digits and no browser exceptions');
 fs.writeFileSync(`${out}/browser-results.json`,JSON.stringify({url:url.startsWith('file:')?'Standalone bundle of the same React component':url,results,errors},null,2));
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
