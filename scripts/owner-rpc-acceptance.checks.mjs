import test from 'node:test';
import assert from 'node:assert/strict';
import {verify,QA_URL,TEST_EMAIL,cases} from './owner-rpc-acceptance.mjs';
const key='header.'+Buffer.from(JSON.stringify({role:'anon',ref:'weucywfwbdnomtlkjurl'})).toString('base64url')+'.signature';
function mock({owner=false,badRpc=false}={}){
 const seen=[];
 const request=async(url,options)=>{
  seen.push(url);let data,status=200;
  if(url.endsWith('grant_type=password'))data={access_token:'test-access',refresh_token:'test-refresh',user:{id:'test-user',email:TEST_EMAIL}};
  else if(url.endsWith('/auth/v1/user'))data={id:'test-user'};
  else if(url.endsWith('/owner_authorized'))data=owner;
  else if(url.includes('/rest/v1/rpc/')){status=badRpc?404:403;data={code:badRpc?'PGRST202':'42501'};}
  else if(url.includes('/logout')){status=204;return new Response(null,{status});}
  else if(url.endsWith('grant_type=refresh_token')){status=400;data={error_code:'refresh_token_not_found'};}
  else throw Error('Unexpected request');
  return new Response(JSON.stringify(data),{status});
 };return {request,seen};
}
test('rejects another project and service-role keys before network access',async()=>{
 let count=0;const request=async()=>{count++;};
 await assert.rejects(verify({url:'https://another.supabase.co',key,password:'test',request}),/CONFIG/);
 const serviceKey='x.'+Buffer.from(JSON.stringify({role:'service_role',ref:'weucywfwbdnomtlkjurl'})).toString('base64url')+'.x';
 await assert.rejects(verify({key:serviceKey,password:'test',request}),/ANON/);assert.equal(count,0);
});
test('rejects owner identity and logs out without invoking protected RPCs',async()=>{
 const m=mock({owner:true});await assert.rejects(verify({key,password:'test',request:m.request}),/ORDINARY/);
 assert.equal(m.seen.filter(x=>x.includes('/rest/v1/rpc/')).length,1);assert.ok(m.seen.some(x=>x.includes('/logout')));
});
test('requires all eleven genuine permission errors, logout and revocation',async()=>{
 const m=mock();const result=await verify({key,password:'test',request:m.request});
 assert.equal(result.cases.length,11);assert.ok(result.passed&&result.logout&&result.refreshRevoked);
 assert.ok(cases.slice(-2).every(([,args])=>Object.values(args).every(v=>v===null)));
 assert.ok(!JSON.stringify(result).includes('test-access'));
});
test('does not mistake an absent RPC for an authorization denial',async()=>{
 const m=mock({badRpc:true});await assert.rejects(verify({key,password:'test',request:m.request}),/RPC_DENIAL_FAILED/);
 assert.ok(m.seen.some(x=>x.includes('/logout')));
});
