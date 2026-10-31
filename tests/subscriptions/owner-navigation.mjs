// Compare the middleware change on identical disposable data and production builds.
// The baseline differs only in using the previous network getUser middleware gate.
import assert from 'node:assert/strict';
import {cp,readFile,writeFile,mkdtemp,symlink,rm} from 'node:fs/promises';
import {execFileSync,spawn} from 'node:child_process';
import {join,resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import {createServerClient} from '@supabase/ssr';

const routes=['/admin','/admin/users','/admin/companies','/admin/subscriptions','/admin/payments','/admin/analytics','/admin/settings'];
const median=values=>{const v=[...values].sort((a,b)=>a-b);return v[Math.floor(v.length/2)]};
export async function ownerNavigation({browser,cookies,appUrl,status,ordinary,owner,sql,check}) {
 assert.equal(appUrl,'http://127.0.0.1:3000');
 assert.ok(process.env.RUNNER_TEMP);
 const root=process.cwd(),baseline=await mkdtemp(join(process.env.RUNNER_TEMP,'owner-navigation-'));
 const result={scope:'Identical local data and builds; only middleware getUser vs getClaims differs',samplesPerRoute:5,rows:[],productionTiming:false};
 let server;
 try {
  await cp(root,baseline,{recursive:true,filter:path=>!['node_modules','.git','.next'].includes(path.slice(root.length+1).split('/')[0])});
  await symlink(resolve(root,'node_modules'),join(baseline,'node_modules'),'dir');
  const path=join(baseline,'middleware.ts'),source=await readFile(path,'utf8');
  const gate='const {data: claimsData, error: claimsError} = await supabase.auth.getClaims();';
  assert.ok(source.includes(gate));
  await writeFile(path,source.replace(gate,'const {data: {user}, error: claimsError} = await supabase.auth.getUser(); const claimsData = user ? {claims: {sub: user.id}} : null;'));
  const env={...process.env,NEXT_PUBLIC_SUPABASE_URL:status.API_URL,NEXT_PUBLIC_SUPABASE_ANON_KEY:status.ANON_KEY,NEXT_PUBLIC_APP_URL:appUrl,SUPABASE_SERVICE_ROLE_KEY:'',RESEND_API_KEY:''};
  execFileSync('npm',['run','build'],{cwd:baseline,env,stdio:'pipe',timeout:300000});
  server=spawn('node',[join(root,'node_modules/next/dist/bin/next'),'start','-H','127.0.0.1','-p','3001'],{cwd:baseline,env,stdio:'ignore'});
  for(let n=0;n<80;n++){try{assert.equal((await fetch('http://127.0.0.1:3001/en/login')).status,200);break}catch{if(n===79)throw Error('Baseline server unavailable');await new Promise(r=>setTimeout(r,250))}}
  for(const locale of ['ar','en']) {
   for(const [label,origin] of [['before','http://127.0.0.1:3001'],['after',appUrl]]) {
    const context=await browser.newContext();
    try {
     await context.addCookies(cookies.map(c=>({name:c.name,value:c.value,url:origin})));
     const page=await context.newPage();page.setDefaultTimeout(30000);
     await page.goto(origin+'/admin?lang='+locale);await page.locator('.owner-top h1').waitFor();
     // Warm each route once; then measure the actual tab click until its heading/data shell is ready.
     for(let round=0;round<6;round++)for(const route of routes) {
      const target=route+'?lang='+locale;
      const current=new URL(page.url());
      if(current.pathname===route) {
       await page.locator('.owner-tabs a[href="/admin/settings?lang='+locale+'"]').click();
       await page.waitForURL(u=>u.pathname==='/admin/settings');await page.locator('.owner-top h1').waitFor();
      }
      const start=performance.now();
      await page.locator('.owner-tabs a[href="'+target+'"]').click();
      await page.waitForURL(u=>u.pathname===route&&u.searchParams.get('lang')===locale);
      await page.locator('.owner-top h1').waitFor();
      if(route==='/admin/subscriptions')await page.locator('.owner-institution-table tbody tr').first().waitFor();
      if(route==='/admin/analytics')assert.equal(await page.locator('.owner-metric-card').count(),4);
      assert.equal(await page.locator('.owner-denied').count(),0);
      if(round)result.rows.push({label,locale,route,ms:Math.round(performance.now()-start)});
     }
    } finally {await context.close()}
   }
  }
  result.summary=routes.map(route=>{const before=median(result.rows.filter(r=>r.label==='before'&&r.route===route).map(r=>r.ms)),after=median(result.rows.filter(r=>r.label==='after'&&r.route===route).map(r=>r.ms));return {route,beforeMedianMs:before,afterMedianMs:after,improvementPercent:Math.round((before-after)/before*1000)/10}});
  result.beforeMedianMs=median(result.rows.filter(r=>r.label==='before').map(r=>r.ms));
  result.afterMedianMs=median(result.rows.filter(r=>r.label==='after').map(r=>r.ms));
  console.log('OWNER_NAVIGATION_TIMING '+JSON.stringify(result.summary));
  await check('all seven owner pages deny ordinary users, forged metadata and revoked owner roles in AR/EN',async()=>{
   assert.ifError((await ordinary.client.auth.updateUser({data:{role:'platform_owner'}})).error);
   const jar=[];
   const ssr=createServerClient(status.API_URL,status.ANON_KEY,{cookies:{getAll:()=>jar,setAll:cs=>{for(const c of cs){const i=jar.findIndex(x=>x.name===c.name);if(i>=0)jar.splice(i,1);jar.push(c)}}}});
   assert.ifError((await ssr.auth.signInWithPassword({email:ordinary.email,password:ordinary.password})).error);
   const ordinaryHeader=jar.map(c=>c.name+'='+c.value).join(';'),ownerHeader=cookies.map(c=>c.name+'='+c.value).join(';');
   for(const locale of ['ar','en'])for(const route of routes){
    const r=await fetch(appUrl+route+'?lang='+locale,{headers:{Cookie:ordinaryHeader}});assert.equal(r.status,200);
    const html=await r.text();assert.ok(html.includes('owner-denied'));assert.ok(!html.includes('class="owner-shell"'));
   }
   // JWT remains valid while the database role is revoked; access must still stop immediately.
   sql("delete from public.platform_admins where user_id='"+owner.id+"'");
   try{for(const locale of ['ar','en'])for(const route of routes){const r=await fetch(appUrl+route+'?lang='+locale,{headers:{Cookie:ownerHeader}});assert.ok((await r.text()).includes('owner-denied'))}}
   finally{sql("insert into public.platform_admins(user_id,role) values('"+owner.id+"','platform_owner')")}
  });
 } finally {
  server?.kill('SIGTERM');
  await writeFile(join(root,'tests/subscriptions/owner-navigation-result.json'),JSON.stringify(result,null,2)+'\n');
  await rm(baseline,{recursive:true,force:true});
 }
}
