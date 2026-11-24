import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';

// This runs only in the disposable Auth/API fixture, never against hosted QA or Production.
export async function runWaterFinancialPolicyBrowser({browser,cookies,check}){
 await check('Explicit cash cycle, capped depreciation, terminal cash, saved policy and bilingual template PDF evidence',async()=>{
  const app='http://localhost:3000',contexts=[];
  const path=name=>new URL('./screenshots/'+name,import.meta.url).pathname;
  async function open(){
   const context=await browser.newContext({viewport:{width:1440,height:1000}});contexts.push(context);
   await context.addCookies(cookies.map(c=>({name:c.name,value:c.value,url:app})));
   const page=await context.newPage();page.setDefaultTimeout(15000);return page;
  }
  const parseCsv=text=>text.replace(/^\uFEFF/,'').split('\r\n').map(line=>[...line.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g)].map(x=>x[1].replaceAll('""','"')));
  const evidence={source:'disposable-local-Auth/API/Chromium',head:process.env.GITHUB_SHA||'LOCAL',pdfs:[],screenshots:[],assertions:[]};
  try{
   let page=await open();await page.goto(app+'/en/feasibility?scope=PERSONAL');
   let response=await page.request.get(app+'/api/feasibility/projects');assert.equal(response.status(),200);
   const rows=await response.json();
   const water=structuredClone(rows.find(x=>x.title==='Synthetic dynamic water costing').study);
   water.id=randomUUID();water.title='Synthetic cash-cycle water acceptance';water.currency='USD';
   delete water.water.quantityCosting;delete water.water.financialPolicy;
   Object.assign(water.water.capex,{buildings:9000,line:1000,treatment:0,power:0,lab:0,vehicles:0,licenses:0,others:0,contingencyPct:0,workingCapital:100});
   Object.assign(water.water.deal,{landMode:'transfer',landValue:0,landArea:1000,investorLoan:300,loanInterest:10,loanYears:3,loanStart:1,extraFunding:0,leaseMonth:0});
   Object.assign(water.water.ops,{bottlesHour:12,hoursDay:1,daysMonth:10,bottlesCarton:12,litersBottle:1,priceCarton:10,variableCarton:4,fixedMonth:10,
    life:2,horizon:3,nwcPct:10,taxRate:20,discountRate:10,util:[100,100,100],maintenancePct:0,priceGrowth:0,costGrowth:0,fixedGrowth:0});
   water.water.operationsPlan={sourceName:'Synthetic source',permitReference:'Synthetic permit',packagingLossPct:0,kwhPerThousandBottles:0,cartonsPerTrip:0,roundTripKm:0,collectionDays:30};
   response=await page.request.post(app+'/api/feasibility/projects',{headers:{Origin:app},data:{study:water}});assert.equal(response.status(),201,await response.text());
   await page.context().close();page=await open();await page.goto(app+'/en/feasibility?scope=PERSONAL');
   await page.getByRole('button',{name:'Restore from cloud',exact:true}).click();
   await page.getByRole('button',{name:new RegExp(water.title)}).click();
   await page.getByRole('button',{name:'Advanced model',exact:true}).click();
   const policy=page.locator('.fs-financial-policy');
   await policy.getByRole('combobox',{name:'Working capital method',exact:true}).selectOption('CYCLE');
   await policy.getByRole('combobox',{name:'Depreciation method',exact:true}).selectOption('CLASSES');
   await policy.getByRole('spinbutton',{name:'Class life in years · Buildings',exact:true}).fill('3');
   await policy.getByRole('spinbutton',{name:'Class life in years · Bottling line',exact:true}).fill('1');
   assert.equal(await policy.getByRole('spinbutton',{name:'Depreciation life in years',exact:true}).isDisabled(),true);
   await policy.getByRole('combobox',{name:'Depreciation method',exact:true}).selectOption('CAPPED');
   assert.equal(await policy.getByRole('spinbutton',{name:'Depreciation life in years',exact:true}).inputValue(),'2');
   assert.equal(await policy.getByRole('spinbutton',{name:'Depreciation life in years',exact:true}).isEnabled(),true);
   await policy.getByRole('combobox',{name:'Calculation year days',exact:true}).selectOption('360');
   await policy.getByRole('spinbutton',{name:'Inventory days',exact:true}).fill('15');
   await policy.getByRole('spinbutton',{name:'Supplier credit days',exact:true}).fill('45');
   await policy.locator('summary').click();
   await policy.getByRole('spinbutton',{name:'Terminal working capital recovery %',exact:true}).fill('100');
   await policy.getByRole('spinbutton',{name:'Net terminal asset and land sale proceeds',exact:true}).fill('200');
   await policy.getByRole('textbox',{name:'Financial policy assumption evidence',exact:true}).fill('Synthetic only — lives 2y, cycle 30/15/45 days, net exit 200; not market evidence.');
   assert.equal(await page.getByRole('spinbutton',{name:'Working capital as % of sales',exact:true}).isDisabled(),true);
   const posted=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/feasibility/projects'&&r.request().method()==='PATCH');
   await page.getByRole('button',{name:'Save to cloud',exact:true}).click();assert.equal((await posted).status(),200);
   response=await page.request.get(app+'/api/feasibility/projects');assert.equal(response.status(),200);
   let saved=(await response.json()).find(x=>x.id===water.id);
   assert.equal(saved.study.water.financialPolicy.workingCapitalMode,'CYCLE');assert.equal(saved.study.water.financialPolicy.depreciationMode,'CAPPED');
   assert.equal(saved.study.water.ops.nwcPct,10);assert.equal(saved.study.water.ops.life,2);assert.equal(saved.study.water.operationsPlan.collectionDays,30);
   assert.deepEqual(saved.study.water.financialPolicy.assetLives,{buildings:3,line:1});
   await page.reload();await page.getByRole('button',{name:'Advanced model',exact:true}).click();
   assert.equal(await policy.getByRole('spinbutton',{name:'Inventory days',exact:true}).inputValue(),'15');
   await policy.locator('summary').click();
   assert.equal(await policy.getByRole('spinbutton',{name:'Terminal working capital recovery %',exact:true}).inputValue(),'100');
   await page.getByRole('button',{name:'Report and export',exact:true}).click();
   await page.locator('.fs-financial-policy').getByText('Operating cycle days',{exact:true}).waitFor();
   const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Export forecast CSV',exact:true}).click();
   const file=await downloading,csv=parseCsv(await readFile(await file.path(),'utf8')),headers=csv[0];
   const value=(row,name)=>Number(csv[row][headers.indexOf(name)]);
   assert.equal(csv.length,5);assert.equal(value(1,'Project free cash flow'),-10100);
   assert.equal(value(2,'Trade receivables'),100);assert.equal(value(2,'Inventory'),20);assert.equal(value(2,'Supplier credit'),60);
   assert.equal(value(2,'Project free cash flow'),640);assert.equal(value(3,'Project free cash flow'),600);
   assert.equal(value(4,'Depreciation'),0);assert.equal(value(4,'Working capital liquidation'),60);assert.equal(value(4,'Net terminal sale proceeds'),200);
   assert.equal(value(4,'Project free cash flow'),740);assert.equal(value(4,'Operating cash before terminal proceeds'),480);assert.equal(value(4,'Working capital after liquidation'),0);
   assert.ok(Math.abs(value(4,'Debt service coverage (DSCR)')-480/110)<1e-9);
   assert.equal(csv[4][headers.indexOf('Project free cash flow')],'740.00');
   evidence.assertions.push('UI policy PATCH/read/reload retained; legacy percentage stored but disabled; CSV flows -10100/640/600/740; operating DSCR 480/110 excludes exit 260');

   // Seed a separate public-land fixture with synthetic quantities and a narrow 15-column cash-flow table.
   const land=structuredClone(rows.find(x=>x.title==='Synthetic dynamic land costing').study);
   land.id=randomUUID();land.title='Synthetic detailed land PDF acceptance';land.currency='USD';
   const r=land.rawLand;r.project={startYear:2026,years:4,discountRate:.1};
   Object.assign(r.site,{areaAfterPriorTransfers:1000,excludedValley:200,extraExcluded:0,otherConstraintsSqm:0,serviceRatio:.25,landPricePerNetSqm:10,landPaymentMethod:'cash',acquisitionBasis:'NET'});
   const item=(id,name,category,basis,unitCost)=>({id,name,category,basis,quantity:1,unit:'m² or m',unitCost,source:'Synthetic specification and price reference 2026-01-01 — not a market quotation.'});
   r.quantityDevelopment={roadLength:100,networkLength:50,serviceArea:0,landTiming:'YEAR0',committedEquity:8000,budget:{enabled:true,items:[
    item('roads','Synthetic roads','roads','ROAD_LENGTH',20),item('earth','Synthetic earthworks','earthworks','NET_AREA',3),item('network','Synthetic water network','networks','NETWORK_LENGTH',10)]}};
   r.sales.mix=[{name:'Synthetic saleable use',enabled:true,share:1,price:100,annualGrowthAdjustment:0}];
   response=await page.request.post(app+'/api/feasibility/projects',{headers:{Origin:app},data:{study:land}});assert.equal(response.status(),201,await response.text());
   await page.context().close();page=await open();await page.goto(app+'/en/feasibility?scope=PERSONAL');await page.getByRole('button',{name:'Restore from cloud',exact:true}).click();
   for(const [kind,study] of [['water',water],['land',land]]){
    await page.getByRole('button',{name:'Overview',exact:true}).click();await page.getByRole('button',{name:new RegExp(study.title)}).click();
    for(const locale of ['ar','en'])for(const width of [1440,390]){
     await page.setViewportSize({width,height:1000});await page.goto(app+'/'+locale+'/feasibility?scope=PERSONAL');const ar=locale==='ar';
     if(kind==='water'){
      await page.getByRole('button',{name:ar?'النموذج المالي المتقدم':'Advanced model',exact:true}).click();
      assert.equal(await page.getByRole('spinbutton',{name:ar?'أيام التحصيل المستخدمة':'Effective collection days',exact:true}).inputValue(),'30');
      await page.evaluate(()=>window.scrollTo(0,0));
      const name='template-finance-water-policy-'+locale+'-'+width+'.png';await page.screenshot({path:path(name),fullPage:true});evidence.screenshots.push(name);
     }
     await page.getByRole('button',{name:ar?'التقرير والتصدير':'Report and export',exact:true}).click();
     await page.locator('.fs-print-report').waitFor();await page.evaluate(()=>document.fonts.ready);
     assert.equal(await page.locator('body').evaluate(el=>el.scrollWidth<=innerWidth),true);
     await page.evaluate(()=>window.scrollTo(0,0));
     const name='template-finance-'+kind+'-report-'+locale+'-'+width+'.png';await page.screenshot({path:path(name),fullPage:true});evidence.screenshots.push(name);
     if(width===1440){
      await page.emulateMedia({media:'print'});
      try{
       assert.equal(await page.locator('.fs-print-report button:visible').count(),0,'Export controls must not leak into the printed investment report');
       const overflow=await page.locator('.fs-print-report .fs-table').evaluateAll(tables=>tables.some(t=>t.getBoundingClientRect().width>document.documentElement.clientWidth+1));
       assert.equal(overflow,false,'Printed financial tables must fit the page width');
       const pdf='template-finance-'+kind+'-'+locale+'.pdf',bytes=await page.pdf({path:path(pdf),format:'A4',landscape:true,printBackground:true,margin:{top:'12mm',bottom:'12mm',left:'10mm',right:'10mm'}});
       const pages=(bytes.toString('latin1').match(/\/Type\s*\/Page\b/g)??[]).length;
       assert.ok(pages>0&&pages<=7,kind+' '+locale+': excessive fragmentation in this compact synthetic report ('+pages+' pages)');evidence.pdfs.push({file:pdf,pages});
      }finally{await page.emulateMedia({media:null});}
     }
    }
   }
   await page.getByRole('button',{name:'Report export options',exact:true}).click();
   const dialog=page.getByRole('dialog');await dialog.getByRole('checkbox',{name:'Executive summary',exact:true}).uncheck();
   const restorePrint=await page.evaluateHandle(()=>{const print=window.print;window.print=()=>{};return()=>{window.print=print;window.dispatchEvent(new Event('afterprint'));};});
   try{
    await dialog.getByRole('button',{name:'Print / PDF',exact:true}).click();await page.emulateMedia({media:'print'});
    assert.equal(await page.locator('[data-report-section="summary"]').isVisible(),false,'Print block layout must respect the omitted-summary choice');
    assert.equal(await page.locator('[data-report-section="funding"]').isVisible(),true);
    assert.equal((await page.pdf({format:'A4',landscape:true})).subarray(0,5).toString(),'%PDF-');
   }finally{await restorePrint.evaluate(restore=>restore());await restorePrint.dispose();await page.emulateMedia({media:null});}
   evidence.assertions.push('AR/EN desktop/mobile: no page overflow; report buttons excluded from print; financial tables fit; four real Chromium PDFs retained for visual review');
   evidence.assertions.push('Compact synthetic reports have at most seven landscape pages; rows may fragment between pages; omitting the executive summary remains effective in the generated PDF');
   await writeFile(new URL('./water-financial-policy-result.json',import.meta.url),JSON.stringify(evidence,null,2));
  }finally{for(const context of contexts)await context.close();}
 });
 await runWaterEquityFinancingBrowser({browser,cookies,check});
}

async function runWaterEquityFinancingBrowser({browser,cookies,check}){
 await check('Water grace interest, equity-return separation, terminal debt and saved bilingual exports',async()=>{
  const app='http://localhost:3000',context=await browser.newContext({viewport:{width:1440,height:1000}});
  const path=name=>new URL('./screenshots/'+name,import.meta.url).pathname;
  const csvRows=text=>text.replace(/^\uFEFF/,'').split('\r\n').map(line=>[...line.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g)].map(x=>x[1].replaceAll('""','"')));
  const evidence={source:'disposable-local-Auth/API/Chromium',head:process.env.GITHUB_SHA||'LOCAL',screenshots:[],pdfs:[],assertions:[]};
  try{
   await context.addCookies(cookies.map(c=>({name:c.name,value:c.value,url:app})));
   const page=await context.newPage();page.setDefaultTimeout(15000);await page.goto(app+'/en/feasibility?scope=PERSONAL');
   let response=await page.request.get(app+'/api/feasibility/projects');assert.equal(response.status(),200);
   const rows=await response.json(),study=structuredClone(rows.find(x=>x.title==='Synthetic cash-cycle water acceptance').study);
   study.id=randomUUID();study.title='Synthetic grace and equity acceptance';const w=study.water;
   delete w.financingPolicy;w.capex.buildings=0;w.capex.line=1000;w.capex.workingCapital=0;
   w.ops.horizon=3;w.ops.nwcPct=0;w.deal.loanStart=2;w.deal.loanYears=3;
   w.financialPolicy={workingCapitalMode:'PERCENT',inventoryDays:0,payableDays:0,daysPerYear:365,depreciationMode:'CAPPED',
    assetLives:{},workingCapitalRecoveryPct:0,terminalAssetProceeds:0,evidence:'Synthetic 2-year depreciation; no working capital.'};
   response=await page.request.post(app+'/api/feasibility/projects',{headers:{Origin:app},data:{study}});assert.equal(response.status(),201,await response.text());
   await page.getByRole('button',{name:'Restore from cloud',exact:true}).click();
   await page.getByRole('button',{name:new RegExp(study.title)}).click();await page.getByRole('button',{name:'Advanced model',exact:true}).click();
   const policy=page.locator('.fs-water-financing');
   await page.locator('.fs-water-financing-settings > summary').click();
   await policy.getByRole('checkbox',{name:'Use explicit financing and equity returns',exact:true}).check();
   await policy.getByRole('combobox',{name:'Grace-period interest',exact:true}).selectOption('CAPITALIZE');
   await policy.getByRole('combobox',{name:'Paid-interest tax treatment',exact:true}).selectOption('PAID');
   await policy.getByText('Debt remains beyond the forecast: extend the horizon or select terminal settlement to show equity IRR',{exact:true}).waitFor();
   await policy.getByRole('combobox',{name:'Debt remaining at forecast end',exact:true}).selectOption('SETTLE');
   await policy.getByRole('textbox',{name:'Financing terms evidence',exact:true}).fill('Synthetic loan 300 at 10%, 1-year capitalized grace, 3 principal instalments, final settlement. No real financing.');
   const posted=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/feasibility/projects'&&r.request().method()==='PATCH');
   await page.getByRole('button',{name:'Save to cloud',exact:true}).click();assert.equal((await posted).status(),200);
   response=await page.request.get(app+'/api/feasibility/projects');assert.equal(response.status(),200);
   const saved=(await response.json()).find(x=>x.id===study.id).study.water;
   assert.deepEqual({...saved.financingPolicy,evidence:''},{graceInterest:'CAPITALIZE',interestTaxMode:'PAID',terminalDebt:'SETTLE',evidence:''});
   assert.equal(saved.deal.loanStart,2);assert.equal(saved.deal.investorLoan,300);
   await page.reload();await page.getByRole('button',{name:'Advanced model',exact:true}).click();
   await page.locator('.fs-water-financing-settings > summary').click();
   assert.equal(await policy.getByRole('combobox',{name:'Grace-period interest',exact:true}).inputValue(),'CAPITALIZE');
   let downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Export equity returns CSV',exact:true}).click();
   const equityDownload=await downloading,equity=csvRows(await readFile(await equityDownload.path(),'utf8'));
   assert.equal(equity.length,5);const val=(i,n)=>Number(equity[i][equity[0].indexOf(n)]);
   assert.equal(val(1,'All equity holders'),-700);assert.equal(val(1,'Shareholder loan'),-300);assert.equal(val(1,'Investor: equity and loan'),-1000);
   assert.equal(val(2,'All equity holders'),580);assert.ok(Math.abs(val(3,'All equity holders')-443.6)<1e-9);
   assert.ok(Math.abs(val(4,'All equity holders')-242.4)<1e-9);assert.equal(val(4,'Shareholder loan'),242);
   assert.ok(Math.abs(val(4,'Investor: equity and loan')-484.4)<1e-9);
   await writeFile(path('template-finance-water-equity.csv'),await readFile(await equityDownload.path()));
   await page.getByRole('button',{name:'Report and export',exact:true}).click();
   downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Export forecast CSV',exact:true}).click();
   const forecast=csvRows(await readFile(await (await downloading).path(),'utf8'));
   const fv=(i,n)=>Number(forecast[i][forecast[0].indexOf(n)]);
   assert.equal(fv(2,'Capitalized interest'),30);assert.equal(fv(4,'Terminal debt settlement'),110);assert.equal(fv(4,'Closing loan balance'),0);
   assert.ok(Math.abs(fv(4,'Indicative interest tax saving')-4.4)<1e-9);
   assert.ok(Math.abs(fv(4,'Debt service coverage (DSCR)')-484.4/242)<1e-9);
   for(let i=1;i<=4;i++)assert.ok(Math.abs(val(i,'All equity holders')+val(i,'Shareholder loan')-fv(i,'Project free cash flow')-fv(i,'Indicative interest tax saving'))<1e-8);
   evidence.assertions.push('Real UI: capitalization/paid tax/final settlement PATCH/read/reload; separate equity CSV -700/580/443.6/242.4; shareholder-loan inception -300 and final receipt242; debt closes0; DSCR484.4/242; project/equity/loan reconciliation each year.');
   for(const locale of ['ar','en'])for(const width of [1440,390]){
    await page.setViewportSize({width,height:1000});await page.goto(app+'/'+locale+'/feasibility?scope=PERSONAL');const ar=locale==='ar';
    await page.getByRole('button',{name:ar?'النموذج المالي المتقدم':'Advanced model',exact:true}).click();
    await page.locator('.fs-water-financing-settings > summary').click();
    assert.equal(await page.locator('.fs-water-financing select').first().inputValue(),'CAPITALIZE');
    const modelNpv=await page.locator('.fs-royal-overview-kpis .fs-metric').filter({hasText:ar?'NPV للمشروع':'Project NPV'}).locator('strong').textContent();
    const modelIrr=await page.locator('.fs-royal-overview-kpis .fs-metric').filter({hasText:ar?'IRR للمشروع':'Project IRR'}).locator('strong').textContent();
    const gapLabel=ar?'ذروة العجز النقدي بعد التأسيس وخدمة الدين':'Peak post-establishment cash shortfall after debt service';
    const gapAmount=page.locator('dl > div').filter({has:page.getByText(gapLabel,{exact:true})}).locator('dd bdi');
    const modelGap=await gapAmount.textContent();
    assert.notEqual(modelGap,'—');
    for(const kind of ['advanced','report']){
     if(kind==='report'){
      await page.getByRole('button',{name:ar?'التقرير والتصدير':'Report and export',exact:true}).click();
      const reportMetrics=page.locator('.fs-royal-report-summary-kpis .fs-metric');
      assert.equal(await reportMetrics.filter({hasText:'NPV'}).locator('bdi').textContent(),modelNpv);
      assert.equal(await reportMetrics.filter({hasText:'IRR'}).locator('bdi').textContent(),modelIrr);
      assert.equal(await gapAmount.textContent(),modelGap);
      const index=page.getByRole('navigation',{name:ar?'الأقسام التي يشملها التقرير':'Report contents'});
      for(const [name,complete] of [[ar?'هيكل التمويل وقروض المساهمين':'Funding and shareholder loans',true],
       [ar?'التراخيص والمهام والمخاطر':'Licences, tasks and risks',false]]){
       const badge=index.getByRole('link',{name,exact:true}).locator('[data-complete]');
       assert.equal(await badge.getAttribute('data-complete'),String(complete));
      }
      await page.getByRole('link',{name:ar?/راجع المتطلبات المفتوحة/:/Review open requirements/}).press('Enter');
      const checks=page.locator('.fs-report-requirements');
      assert.equal(await checks.evaluate(el=>document.activeElement===el),true);
      const labels=await checks.locator('[data-complete]').evaluateAll(items=>items.map(item=>item.dataset.complete));
      assert.ok(labels.includes('false')&&labels.includes('true'));
      assert.equal(labels.join(','),labels.toSorted().join(','),'Open requirements must come first');
     }
     await page.evaluate(()=>document.fonts.ready);assert.equal(await page.locator('body').evaluate(el=>el.scrollWidth<=innerWidth),true);
     const equityRegion=page.getByRole('region',{name:ar?'جدول عوائد الملكية، قابل للتمرير أفقيًا':'Equity return schedule, horizontally scrollable',exact:true});
     assert.equal(await equityRegion.locator('tbody tr').last().locator('td').first().textContent(),
      new Intl.NumberFormat(locale,{maximumFractionDigits:2}).format(val(4,'All equity holders'))+' USD');
     if(width===390){
      assert.ok(await equityRegion.evaluate(el=>el.scrollWidth>el.clientWidth),'Narrow screens must scroll the financial table internally');
      assert.ok(await equityRegion.locator('thead th').evaluateAll(cells=>cells.slice(1).every(c=>c.getBoundingClientRect().width>=70)),'Financial column labels must retain a readable width');
      if(kind==='advanced'){
       const debtRegion=page.getByRole('region',{name:ar?'جدول خدمة الدين، قابل للتمرير أفقيًا':'Debt service schedule, horizontally scrollable',exact:true});
       assert.ok(await debtRegion.locator('thead th').evaluateAll(cells=>cells.slice(1).every(c=>c.getBoundingClientRect().width>=70)),'Debt columns must not collapse into individual letters');
       const sticky=await debtRegion.evaluate(el=>{
        const year=el.querySelector('tbody th');
        const before=year.getBoundingClientRect().left;
        el.scrollLeft=(getComputedStyle(el).direction==='rtl'?-1:1)*el.scrollWidth;
        const result={scrolled:Math.abs(el.scrollLeft)>100,shift:Math.abs(year.getBoundingClientRect().left-before)};
        el.scrollLeft=0;
        return result;
       });
       assert.ok(sticky.scrolled&&sticky.shift<=1,'The year must remain visible when scrolling the debt schedule in either direction');
      }
     }
     await page.evaluate(()=>window.scrollTo(0,0));
     const shot='template-finance-water-equity-'+kind+'-'+locale+'-'+width+'.png';await page.screenshot({path:path(shot),fullPage:true});evidence.screenshots.push(shot);
     if(kind==='report'&&width===1440){
      await page.emulateMedia({media:'print'});
      try{
       assert.equal(await page.locator('.fs-print-report button:visible').count(),0);
       const name='template-finance-water-equity-'+locale+'.pdf',bytes=await page.pdf({path:path(name),format:'A4',landscape:true,printBackground:true,margin:{top:'12mm',bottom:'12mm',left:'10mm',right:'10mm'}});
       evidence.pdfs.push({file:name,pages:(bytes.toString('latin1').match(/\/Type\s*\/Page\b/g)??[]).length});
      }finally{await page.emulateMedia({media:null});}
     }
    }
   }
   evidence.assertions.push('AR/EN desktop/mobile: project NPV/IRR and peak cash gap match the report, terminal equity cash flow matches the CSV, report statuses reflect actual checks, open checks are keyboard reachable, and the mobile debt schedule pins the year.');
   await writeFile(new URL('./water-equity-financing-result.json',import.meta.url),JSON.stringify(evidence,null,2));
  }finally{await context.close();}
 });
}
