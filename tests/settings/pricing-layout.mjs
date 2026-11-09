import assert from 'node:assert/strict';
export async function verifyPricingLayout({page,locale,out}) {
 const ar=locale==='ar';
 const cards=page.locator('.pricing-card');
 await cards.first().waitFor();
 for(const width of [1490,768,390,320]) {
  await page.setViewportSize({width,height:1050});
  await page.waitForTimeout(350);
  await page.evaluate(()=>document.fonts.ready);
  const layout=await page.locator('.pricing-grid').evaluate(grid=>{
   const g=grid.getBoundingClientRect();const cards=[...grid.children].map(e=>e.getBoundingClientRect());
   return {width:g.width,left:g.left,right:g.right,cards:cards.map(c=>({width:c.width,left:c.left,right:c.right,top:c.top}))};
  });
  assert.ok(Math.abs(Math.min(...layout.cards.map(c=>c.left))-layout.left)<2);
  assert.ok(Math.abs(Math.max(...layout.cards.map(c=>c.right))-layout.right)<2,'Cards fill available width without an empty third column');
  if(width===1490)assert.ok(Math.abs(layout.cards[0].top-layout.cards[1].top)<2);
  if(width<=390)assert.ok(Math.abs(layout.cards[0].width-layout.width)<2);
  const row=await page.locator('.pricing-period-row').boundingBox();
  const label=await page.locator('.pricing-period-label').boundingBox();
  assert.ok(ar?Math.abs(row.x+row.width-label.x-label.width)<2:Math.abs(row.x-label.x)<2,'Period aligns with reading direction');
  const active=page.locator('.pricing-interval [aria-pressed=true]');
  assert.equal(await active.evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(32, 83, 71)');
  for(const detail of await page.locator('.billing-package-details').all()) {
   if(!await detail.evaluate(e=>e.open))await detail.locator('summary').click();
  }
  for(const item of await page.locator('.billing-package-details li').all()) {
   assert.equal(await item.locator('svg').count(),1);
   assert.equal(await item.locator('svg').evaluate(e=>getComputedStyle(e).color),'rgb(198, 163, 93)');
  }
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No viewport overflow');
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:`${out}/pricing-details-${locale}-${width}.png`,fullPage:true});
 }
 await page.locator('.pricing-interval').getByRole('button',{name:ar?'سنوي':'Yearly',exact:true}).click();
 assert.equal(await page.locator('.pricing-card').count(),0,'Empty annual catalog never substitutes monthly prices');
 await page.locator('.pricing-interval').getByRole('button',{name:ar?'شهري':'Monthly',exact:true}).click();
 assert.equal(await page.locator('.pricing-card').count(),2);
 await page.setViewportSize({width:1490,height:1050});
}
