import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomUUID,randomBytes} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';

export async function verifyInvitationFlow({browser,appUrl,url,status,owner,existing,cookieHeader,headers,sql}){
 const mailbox=status.INBUCKET_URL??'http://127.0.0.1:54324';
 assert.equal(new URL(mailbox).hostname,'127.0.0.1');
 const adapter=createServer(async(req,res)=>{
  try{
   let raw='';for await(const part of req)raw+=part;
   const m=JSON.parse(raw);
   const r=await fetch(mailbox+'/api/v1/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({From:{Email:'sender@qa.test'},To:[{Email:m.to[0]}],Subject:m.subject,HTML:m.html,Text:m.text})});
   assert.ok(r.ok,'Mailpit receive');res.end(JSON.stringify({id:randomUUID()}));
  }catch{res.statusCode=502;res.end();}
 });
 await new Promise(resolve=>adapter.listen(3001,'127.0.0.1',resolve));
 try{
  const created=await fetch(url+'/rest/v1/organizations',{method:'POST',headers:{...headers(owner),Prefer:'return=representation'},body:JSON.stringify({name:'Invitation acceptance QA',owner_user_id:owner.id})});
  assert.equal(created.status,201);const org=(await created.json())[0].id;
  sql('grant select on organization_invitations to service_role');
  for(const isNew of [true,false]){
   const email=isNew?'invited-new@qa.test':existing.email,password=isNew?randomBytes(22).toString('hex')+'x8':existing.password,id=randomUUID(),token=randomUUID();
   sql(`insert into organization_invitations(id,organization_id,email,role,token) values('${id}','${org}','${email}','VIEWER','${token}')`);
   const sent=await fetch(appUrl+'/api/organizations/invitations/email',{method:'POST',headers:{Cookie:cookieHeader,'Content-Type':'application/json'},body:JSON.stringify({organization_id:org,invitation_id:id,locale:isNew?'ar':'en'})});
   assert.equal(sent.status,202,await sent.text());
   const inbox=await (await fetch(mailbox+'/api/v1/messages')).json(),msg=inbox.messages.find(m=>m.To.some(t=>t.Address===email));assert.ok(msg);
   const mail=await (await fetch(mailbox+'/api/v1/message/'+msg.ID)).json();
   const href=[...mail.HTML.matchAll(/href="([^"]+)"/g)].map(m=>m[1].replaceAll('&amp;','&')).find(h=>h.includes('/login/invitation#'));assert.ok(href);
   const binding=Object.fromEntries(new URLSearchParams(new URL(href).hash.slice(1)));
   const post=body=>fetch(appUrl+'/api/organizations/invitations/activate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
   assert.equal((await post({...binding,proof:'0'.repeat(64),action:'inspect'})).status,410);
   const context=await browser.newContext(),page=await context.newPage();await page.goto(href);
   const field=page.locator('input[type=email]');await field.waitFor();assert.equal(await field.inputValue(),email);assert.equal(await field.isEditable(),false);
   if(!isNew){
    assert.equal((await post({...binding,action:'activate',password:'CannotOverwrite123!'})).status,409);
    await page.getByRole('button',{name:'I already have an account — sign in and accept invitation'}).click();
   }
   await page.screenshot({path:'tests/subscriptions/screenshots/invitation-'+(isNew?'new-ar':'existing-en')+'.png'});
   await page.locator('[name=password]').fill(password);
   if(isNew)await page.locator('[name=confirm]').fill(password);
   const activation = page.waitForResponse(r=>r.url().endsWith('/api/organizations/invitations/activate')&&r.request().method()==='POST');
   await page.locator('form button').first().click();
   const activated = await activation;
   assert.equal(activated.status(),200,await activated.text());
   await page.getByRole('status').filter({hasText:isNew?'تم تفعيل حسابك وقبول الدعوة':'Your account is active'}).waitFor();
   await page.waitForURL(u=>u.pathname.endsWith('/dashboard')&&u.searchParams.get('organization')===org);
   const client=createClient(url,status.ANON_KEY,{auth:{persistSession:false}});const login=await client.auth.signInWithPassword({email,password});assert.ifError(login.error);
   const member=await client.from('organization_members').select('role,status').eq('organization_id',org).eq('user_id',login.data.user.id).single();assert.ifError(member.error);assert.equal(member.data.status,'ACTIVE');assert.equal(member.data.role,'VIEWER');
   assert.equal((await post({...binding,action:'inspect'})).status,410);await context.close();
  }
 }finally{await new Promise(resolve=>adapter.close(resolve));}
}
