import assert from 'node:assert/strict';
export async function verifyFiscalSetupEditing({page,app,orgId,setLock,out}){
 for(const locale of ['ar','en']){
  const ar=locale==='ar';setLock(null);
  await page.goto(`${app}/${locale}/settings/financial/fiscal-years?organization=${orgId}`);
  const form=page.locator('.fiscal-calendar-settings');
  const month=form.getByLabel(ar?'شهر بداية السنة':'Fiscal start month',{exact:true});
  const retained=form.getByLabel(ar?'حساب الأرباح المحتجزة التفصيلي':'Retained earnings posting account',{exact:true});
  await month.waitFor();assert.equal(await month.isEnabled(),true,'Setup policies alone do not lock the calendar');assert.equal(await retained.isEnabled(),true);
  const next=await month.inputValue()==='1'?'7':'1';await month.selectOption(next);await retained.selectOption('330001');
  await form.getByLabel(ar?'سبب الإعداد أو الإجراء':'Setup or action reason',{exact:true}).fill('Reviewed setup correction');
  await form.getByRole('button',{name:ar?'حفظ إعداد السنة':'Save fiscal calendar',exact:true}).click();
  await page.getByText(ar?'تم حفظ إعداد السنة المالية.':'Fiscal calendar saved.',{exact:true}).waitFor();
  await page.reload();await month.waitFor();assert.equal(await month.inputValue(),next);assert.equal(await retained.inputValue(),'330001');
  for(const width of [1490,390]){
   await page.setViewportSize({width,height:1050});await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(200);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   if(out)await page.screenshot({path:`${out}/fiscal-editable-${locale}-${width}.png`,fullPage:true});
  }
  setLock('ACTIVITY');await page.reload();await month.waitFor();assert.equal(await month.isDisabled(),true);assert.equal(await retained.isDisabled(),true);
  await form.getByText(ar?/بدأت العمليات الفعلية/:/Actual operations have started/).waitFor();
  assert.ok(await page.locator('[data-fiscal-year]').filter({hasText:ar?'مفتوحة':'Open'}).count()>0,'Configuration lock must not close the year');
 }
 setLock(null);
}
