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
   await policy.getByRole('combobox',{name:'Depreciation method',exact:true}).selectOption('CAPPED');
   await policy.getByRole('combobox',{name:'Calculation year days',exact:true}).selectOption('360');
   await policy.getByRole('spinbutton',{name:'Inventory days',exact:true}).fill('15');
   await policy.getByRole('spinbutton',{name:'Supplier credit days',exact:true}).fill('45');
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
   await page.reload();await page.getByRole('button',{name:'Advanced model',exact:true}).click();
   assert.equal(await policy.getByRole('spinbutton',{name:'Inventory days',exact:true}).inputValue(),'15');
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
      assert.equal(await page.locator('.fs-financial-policy input[type=number]').first().inputValue(),'30');
      const name='template-finance-water-policy-'+locale+'-'+width+'.png';await page.screenshot({path:path(name),fullPage:true});evidence.screenshots.push(name);
     }
     await page.getByRole('button',{name:ar?'التقرير والتصدير':'Report and export',exact:true}).click();
     await page.locator('.fs-print-report').waitFor();await page.evaluate(()=>document.fonts.ready);
     assert.equal(await page.locator('body').evaluate(el=>el.scrollWidth<=innerWidth),true);
     const name='template-finance-'+kind+'-report-'+locale+'-'+width+'.png';await page.screenshot({path:path(name),fullPage:true});evidence.screenshots.push(name);
     if(width===1440){
      await page.emulateMedia({media:'print'});
      try{
       assert.equal(await page.locator('.fs-print-report button:visible').count(),0,'Export controls must not leak into the printed investment report');
       const overflow=await page.locator('.fs-print-report .fs-table').evaluateAll(tables=>tables.some(t=>t.getBoundingClientRect().width>document.documentElement.clientWidth+1));
       assert.equal(overflow,false,'Printed financial tables must fit the page width');
       const pdf='template-finance-'+kind+'-'+locale+'.pdf';await page.pdf({path:path(pdf),format:'A4',landscape:true,printBackground:true,margin:{top:'12mm',bottom:'12mm',left:'10mm',right:'10mm'}});evidence.pdfs.push(pdf);
      }finally{await page.emulateMedia({media:null});}
     }
    }
   }
   evidence.assertions.push('AR/EN desktop/mobile: no page overflow; report buttons excluded from print; financial tables fit; four real Chromium PDFs retained for visual review');
   await writeFile(new URL('./water-financial-policy-result.json',import.meta.url),JSON.stringify(evidence,null,2));
  }finally{for(const context of contexts)await context.close();}
 });
}
