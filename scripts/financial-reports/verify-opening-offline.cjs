const {chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const fs=require('node:fs');

async function verifyOpening(){
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const page=await browser.newPage();
 const input=path.resolve(process.argv[2]);
 const errors=[],remote=[];
 page.on('pageerror',error=>errors.push(error.message));
 page.on('request',request=>{if(/^https?:/.test(request.url()))remote.push(request.url());});
 let failure=null;
 try{
  await page.goto(pathToFileURL(input).href);
  try{
   if(errors.length)throw Error(errors[0]);
   await Promise.race([
    page.locator('[data-opening-ready="holding"]').waitFor(),
    page.waitForEvent('pageerror').then(error=>{throw error;}),
   ]);
  }catch(error){
   if(errors.length)throw Error('Offline opening failed to render: '+errors.join(' | '),{cause:error});
   throw error;
  }
  await page.getByLabel('الإضافة: مؤسسة آفاق للخدمات',{exact:true}).fill('12000');
  assert.equal(await page.locator('[data-opening-row="holding-c2"]').getAttribute('data-final'),'12000.0000');
  await page.locator('#ob-tab-summary').click();
  assert.match(await page.locator('.ob-summary-table').innerText(),/47,000.00/);
  await page.getByRole('button',{name:'Switch to English',exact:true}).click();
  await page.locator('#ob-tab-customers').click();
  assert.equal(await page.getByLabel('Supplement: Afaq Services',{exact:true}).inputValue(),'12000');
  await page.setViewportSize({width:390,height:844});
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('.corp-workspace')).marginInlineStart==='0px');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.deepEqual(errors,[]);
  assert.deepEqual(remote,[]);
  console.log('PASS offline opening React preview, inputs, AR/EN and zero network requests');
 }catch(error){
  failure=String(error);
  throw error;
 }finally{
  const checks=failure?[]:['same React preview','exact input and trial balance','language state','mobile width'];
  await browser.close();
  fs.writeFileSync(path.join(path.dirname(input),'opening-offline-results.json'),
   JSON.stringify({errors,remoteRequests:remote,checks,postingEnabled:false,failure},null,2));
 }
}

verifyOpening().catch(error=>{console.error(error);process.exitCode=1;});
