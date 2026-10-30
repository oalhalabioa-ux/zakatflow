// Real browser tests against the disposable local Auth/Mailpit stack only.
// Never record traces, credentials, cookies, email links or page HTML in reports.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {pathToFileURL} from 'node:url';

export async function browserAcceptance({appUrl,emailFor,linkFrom,check,sql}){
 assert.equal(appUrl,'http://127.0.0.1:3000');
 const module=process.env.AUTH_QA_BROWSER_MODULE;
 assert.ok(module?.startsWith(process.env.RUNNER_TEMP+'/'));
 const {chromium}=await import(pathToFileURL(module).href);
 const browser=await chromium.launch();
 try{
  for(const locale of ['ar','en']){
   const ar=locale==='ar',context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
   page.setDefaultTimeout(15000);
   const email=`browser-${locale}@qa.local.test`,password=randomBytes(24).toString('base64url')+'7a';
   const login=appUrl+`/${locale}/login?next=%2F${locale}%2Faccount`;
   const account=appUrl+`/${locale}/account`;
   const visit=()=>page.goto(login);
   const submit=()=>page.locator('form button[type="submit"]').click();
   const signout=async()=>{await page.getByRole('button',{name:ar?'تسجيل الخروج':'Sign out',exact:true}).click();await page.waitForURL(u=>u.pathname===`/${locale}/login`)};
   const heading=text=>page.getByRole('heading',{name:text,exact:true}).waitFor();
   let phase='';
   const run=(name,fn)=>check(`${locale}: browser ${name}`,async()=>{try{await fn()}catch(error){throw Error(`${locale}: browser ${name} failed at ${new URL(page.url()).pathname} (${phase||error.name}; ${String(error.message).split('\n')[0].replaceAll(password,'[redacted]').replace(/https?:\/\/[^\s]+/g,'[test URL]').slice(0,180)})`)}});
   try{
    await run('desktop/mobile methods, alignment, autofill and language',async()=>{
     await visit();assert.equal(await page.locator('#method-password').getAttribute('aria-selected'),'true');
     assert.equal(await page.locator('#login-email').getAttribute('autocomplete'),'username');
     assert.equal(await page.locator('#login-password').getAttribute('autocomplete'),'current-password');
     for(const width of [1440,375]){
      await page.setViewportSize({width,height:1000});
      for(const method of ['password','magic']){
       await page.locator('#method-'+method).click();
       const [switchBox,fieldBox]=await Promise.all([page.locator('.yqa-method-tabs').boundingBox(),page.locator(method==='password'?'.yqa-method-row .yqa-input':'.yqa-method-row .yqa-submit').boundingBox()]);
       assert.equal(switchBox.height,48);assert.equal(fieldBox.height,48);assert.equal(switchBox.y,fieldBox.y);
       assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth));
      }
     }
     await page.setViewportSize({width:1440,height:1000});
     await page.locator('.yqa-languages a').click();await page.waitForURL(u=>u.pathname===`/${ar?'en':'ar'}/login`);
     assert.equal(await page.locator('#method-magic').getAttribute('aria-selected'),'true');
    });
    await run('signup validation, actual form signup and verification restriction',async()=>{
     await visit();await page.locator('#account-signup').click();
     await page.locator('#signup-name').fill('Browser QA');await page.locator('#signup-phone').fill('+966500000001');
     await page.locator('#signup-email').fill(email);await page.locator('#signup-password').fill(password);
     await page.locator('#signup-confirm').fill(password+'x');await page.locator('#signup-terms').check();await submit();
     await page.getByRole('status').filter({hasText:ar?'كلمتا المرور غير متطابقتين.':'Passwords do not match.'}).waitFor();
     await page.locator('#signup-confirm').fill(password);await submit();await heading(ar?'تحقق من بريدك الإلكتروني':'Verify your email');
     assert.equal((await context.cookies()).filter(c=>/-auth-token(?:\.\d+)?$/.test(c.name)).length,0);
     assert.equal(await page.locator('.yqa-status-panel .yqa-submit').isDisabled(),true);
     await visit();await page.locator('#login-email').fill(email);await page.locator('#login-password').fill(password);await submit();await heading(ar?'تحقق من بريدك الإلكتروني':'Verify your email');
    });
    await run('native signup confirmation POST, session persistence and logout',async()=>{
     const link=linkFrom(await emailFor(email));await page.goto(link);
     await heading(ar?'تأكيد البريد الإلكتروني':'Verify email address');
     assert.equal((await context.cookies()).filter(c=>/-auth-token(?:\.\d+)?$/.test(c.name)).length,0);
     const posted=page.waitForRequest(r=>new URL(r.url()).pathname==='/auth/confirm'&&r.method()==='POST');
     await page.getByRole('button',{name:ar?'تأكيد البريد الإلكتروني':'Verify email address',exact:true}).click();
     assert.equal((await posted).headers().origin,appUrl);
     await page.waitForURL(account);await heading(ar?'حسابي':'My Account');
     await page.reload();await heading(ar?'حسابي':'My Account');await signout();
     await page.goto(account);await page.waitForURL(u=>u.pathname===`/${locale}/login`);
    });
    await run('wrong password, correct password and remembered email only',async()=>{
     await visit();await page.locator('#login-email').fill(email);await page.locator('#login-password').fill(password+'x');await submit();
     await page.getByRole('status').waitFor();assert.equal(new URL(page.url()).pathname,`/${locale}/login`);
     await page.locator('#login-password').fill(password);await page.locator('input[name="remember-email"]').check();await submit();
     await page.waitForURL(account);await heading(ar?'حسابي':'My Account');await signout();
     await page.waitForFunction(()=>Boolean(document.querySelector('#login-email')?.value));
     assert.equal(await page.locator('#login-email').inputValue(),email);assert.equal(await page.locator('#login-password').inputValue(),'');
    });
    await run('actual quick-link email, native confirmation and reused-token rejection',async()=>{
     await visit();await page.locator('#login-email').fill(email);await page.locator('#method-magic').click();await submit();await heading(ar?'تم طلب رابط الدخول':'Sign-in link requested');
     assert.equal(await page.locator('.yqa-status-panel .yqa-submit').isDisabled(),true);
     const link=linkFrom(await emailFor(email,ar?'رابط الدخول السريع':'Your quick sign-in link'));await page.goto(link);
     await page.getByRole('button',{name:ar?'تأكيد تسجيل الدخول':'Confirm sign in',exact:true}).click();await page.waitForURL(account);await heading(ar?'حسابي':'My Account');await signout();
     await page.goto(link);await page.getByRole('button',{name:ar?'تأكيد تسجيل الدخول':'Confirm sign in',exact:true}).click();await page.waitForURL(u=>u.searchParams.get('error')==='auth');
    });
    await run('unknown quick-link email never creates an account',async()=>{
     await visit();await page.locator('#login-email').fill(`browser-unknown-${locale}@qa.local.test`);await page.locator('#method-magic').click();await submit();await heading(ar?'تم طلب رابط الدخول':'Sign-in link requested');
     assert.equal(sql(`select count(*) from auth.users where email='browser-unknown-${locale}@qa.local.test'`).trim().split('\n').map(x=>x.trim()).includes('0'),true);
    });
    await run('recovery email, password mismatch, update and new-password sign-in',async()=>{
     // Respect the local Auth mail interval after the immediately preceding magic link.
     await new Promise(resolve=>setTimeout(resolve,1200));
     await visit();await page.locator('#login-email').fill(email);await page.getByRole('button',{name:ar?'نسيت كلمة المرور؟':'Forgot password?',exact:true}).click();await submit();await page.getByRole('status').waitFor();
     phase='open recovery email';const mail=await emailFor(email,'recovery');const href=(mail.HTML??'').match(/href="([^"]+)"/)[1].replaceAll('&amp;','&');await page.goto(href);
     await page.waitForURL(u=>u.pathname==='/auth/reset-password');assert.equal(new URL(page.url()).searchParams.get('lang'),locale);
     phase='recovery password form';const fields=page.locator('form input[type="password"]');await fields.nth(0).fill(password+'2');await fields.nth(1).fill(password+'3');await submit();phase='mismatch message';await page.locator('main p[role="alert"]').waitFor();
     await fields.nth(1).fill(password+'2');await submit();phase='password update status';await page.locator('main p[role="status"]').waitFor();
     phase='recovery logout and re-login';await page.goto(account);await heading(ar?'حسابي':'My Account');await signout();await visit();await page.locator('#login-email').fill(email);await page.locator('#login-password').fill(password+'2');await submit();await page.waitForURL(account);await heading(ar?'حسابي':'My Account');await signout();
    });
   }finally{await context.close()}
  }
 }finally{await browser.close()}
}
