import assert from 'node:assert/strict';

// Real Auth/API/browser on a disposable fixture only; never edits existing QA/Production studies.
export async function runQuantityCostingBrowser({browser,cookies,check}){
 await check('Dynamic template costing: quantities, dependent totals, API persistence, restoration and AR/EN responsive evidence',async()=>{
  const app='http://localhost:3000',context=await browser.newContext({viewport:{width:1440,height:1000}});
  await context.addCookies(cookies.map(c=>({name:c.name,value:c.value,url:app})));
  const page=await context.newPage();page.setDefaultTimeout(12000);
  async function save(){
   const posted=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/feasibility/projects'&&r.request().method()==='POST');
   await page.getByRole('button',{name:'Save to cloud',exact:true}).click();assert.equal((await posted).status(),201);
  }
  async function addRow(section,{basis,cost,quantity=1,category}){
   await section.getByRole('button',{name:'Add quantity item',exact:true}).click();
   const item=section.locator('fieldset').last();
   await item.getByRole('textbox',{name:'Description and specifications',exact:true}).fill('Synthetic quantity specification');
   await item.getByRole('combobox',{name:'Quantity basis',exact:true}).selectOption(basis);
   if(category)await item.getByRole('combobox',{name:'Category',exact:true}).selectOption(category);
   await item.getByRole('spinbutton',{name:'Quantity or multiplier',exact:true}).fill(String(quantity));
   await item.getByRole('textbox',{name:'Unit',exact:true}).fill('m²');
   await item.getByRole('spinbutton',{name:'Unit price',exact:true}).fill(String(cost));
   await item.getByRole('textbox',{name:'Price reference and date',exact:true}).fill('Synthetic independent quote 2026-01-01');
  }
  try{
   await page.goto(app+'/en/feasibility?scope=PERSONAL');
   await page.getByRole('button',{name:'New study',exact:true}).click();
   await page.getByRole('textbox',{name:'New project name',exact:true}).fill('Synthetic dynamic water costing');
   await page.getByRole('radio',{name:'Bottled-water factory',exact:true}).check();await page.getByRole('button',{name:'Add project +',exact:true}).click();
   await page.getByRole('combobox',{name:'Study currency',exact:true}).selectOption('USD');
   await page.getByRole('spinbutton',{name:'Land area (m²)',exact:true}).fill('1000');
   await page.getByRole('button',{name:'Investment',exact:true}).click();
   await page.getByRole('spinbutton',{name:'Construction and buildings',exact:true}).fill('1234');
   await page.getByText('Quantity-based detailed cost estimate',{exact:true}).click();
   await page.getByRole('spinbutton',{name:'Total built floor area m²',exact:true}).fill('200');
   const capital=page.getByRole('heading',{name:'Construction, equipment and utilities quantities',exact:true}).locator('..');
   await capital.getByRole('checkbox').check();await addRow(capital,{basis:'BUILT_AREA',cost:300});
   assert.ok((await capital.innerText()).includes('60000'));
   await page.getByRole('spinbutton',{name:'Total built floor area m²',exact:true}).fill('300');assert.ok((await capital.innerText()).includes('90000'));
   assert.equal(await page.getByRole('button',{name:'Import supplier quote',exact:true}).count(),0);
   await save();let response=await page.request.get(app+'/api/feasibility/projects');assert.equal(response.status(),200);
   let row=(await response.json()).find(x=>x.title==='Synthetic dynamic water costing');assert.ok(row);
   assert.equal(row.study.water.capex.buildings,1234);assert.equal(row.study.water.quantityCosting.builtArea,300);
   assert.equal(row.study.water.quantityCosting.capital.items[0].unitCost,300);
   for(const locale of ['ar','en'])for(const width of [1440,390]){
    await page.setViewportSize({width,height:1000});await page.goto(app+'/'+locale+'/feasibility?scope=PERSONAL');const ar=locale==='ar';
    await page.getByRole('button',{name:ar?'تكاليف الاستثمار':'Investment',exact:true}).click();
    await page.locator('summary').filter({hasText:ar?'التقدير التفصيلي حسب الكميات':'Quantity-based detailed cost estimate'}).click();
    assert.equal(await page.getByRole('spinbutton',{name:ar?'إجمالي مساحة البناء م²':'Total built floor area m²',exact:true}).inputValue(),'300');
    assert.equal(await page.locator('body').evaluate(el=>el.scrollWidth<=innerWidth),true);
    await page.screenshot({path:new URL('./screenshots/dynamic-water-'+locale+'-'+width+'.png',import.meta.url).pathname,fullPage:true});
   }
   const capitalAfter=page.getByRole('heading',{name:'Construction, equipment and utilities quantities',exact:true}).locator('..');
   await capitalAfter.getByRole('checkbox').uncheck();assert.equal(await page.getByRole('spinbutton',{name:'Construction and buildings',exact:true}).inputValue(),'1234');
   await capitalAfter.getByRole('checkbox').check();
   await page.getByRole('button',{name:'Report and export',exact:true}).click();
   await page.getByRole('heading',{name:'Cost basis and quantity evidence',exact:true}).waitFor();
   await page.getByRole('button',{name:'Export quantities and price evidence CSV',exact:true}).waitFor();
   await page.getByRole('button',{name:'Overview',exact:true}).click();await page.getByRole('button',{name:'New study',exact:true}).click();
   await page.getByRole('textbox',{name:'New project name',exact:true}).fill('Synthetic dynamic land costing');
   await page.getByRole('radio',{name:'Raw land and subdivision development',exact:true}).check();await page.getByRole('button',{name:'Add project +',exact:true}).click();
   await page.getByRole('combobox',{name:'Study currency',exact:true}).selectOption('USD');
   await page.getByRole('spinbutton',{name:'Area before exclusions (m²)',exact:true}).fill('2000');
   await page.getByRole('button',{name:'Investment',exact:true}).click();
   await page.getByRole('spinbutton',{name:'Road length m',exact:true}).fill('100');
   const development=page.getByRole('heading',{name:'Area-linked development quantities',exact:true}).locator('..');
   await development.getByRole('checkbox').check();await addRow(development,{basis:'NET_AREA',cost:3});await addRow(development,{basis:'ROAD_LENGTH',cost:20,category:'roads'});
   assert.ok((await development.innerText()).includes('8000'));
   await page.getByRole('button',{name:'Profile',exact:true}).click();await page.getByRole('spinbutton',{name:'Area before exclusions (m²)',exact:true}).fill('3000');
   await page.getByRole('button',{name:'Investment',exact:true}).click();assert.ok((await development.innerText()).includes('11000'));await save();
   response=await page.request.get(app+'/api/feasibility/projects');assert.equal(response.status(),200);
   row=(await response.json()).find(x=>x.title==='Synthetic dynamic land costing');assert.ok(row);
   assert.equal(row.study.rawLand.site.areaAfterPriorTransfers,3000);assert.equal(row.study.rawLand.quantityDevelopment.roadLength,100);
   assert.equal(row.study.rawLand.quantityDevelopment.budget.items.length,2);
   for(const locale of ['ar','en'])for(const width of [1440,390]){
    await page.setViewportSize({width,height:1000});await page.goto(app+'/'+locale+'/feasibility?scope=PERSONAL');const ar=locale==='ar';
    await page.getByRole('button',{name:ar?'تكاليف الاستثمار':'Investment',exact:true}).click();
    assert.equal(await page.getByRole('spinbutton',{name:ar?'طول الطرق م':'Road length m',exact:true}).inputValue(),'100');
    assert.equal(await page.locator('body').evaluate(el=>el.scrollWidth<=innerWidth),true);
    await page.screenshot({path:new URL('./screenshots/dynamic-land-'+locale+'-'+width+'.png',import.meta.url).pathname,fullPage:true});
   }
   await context.close();
   const fresh=await browser.newContext();await fresh.addCookies(cookies.map(c=>({name:c.name,value:c.value,url:app})));
   const reload=await fresh.newPage();await reload.goto(app+'/en/feasibility?scope=PERSONAL');
   await reload.getByRole('button',{name:'Restore from cloud',exact:true}).click();
   await reload.getByRole('button',{name:/Synthetic dynamic water costing/}).click();await reload.getByRole('button',{name:'Investment',exact:true}).click();
   await reload.locator('summary').filter({hasText:'Quantity-based detailed cost estimate'}).click();
   assert.equal(await reload.getByRole('spinbutton',{name:'Total built floor area m²',exact:true}).inputValue(),'300');await fresh.close();
  }finally{await context.close();}
 });
}
