import {expect,it} from 'vitest';
import {isSameOriginRequest} from './request-origin';
const request=(url:string,origin?:string,site?:string)=>new Request(url,{headers:{...(origin?{origin}:{}),...(site?{'sec-fetch-site':site}:{})}});
it('accepts exact same origin on normal and preview hosts',()=>{
 expect(isSameOriginRequest(request('https://preview.vercel.app/api','https://preview.vercel.app'))).toBe(true);
});
it('accepts browser same-origin requests behind the hosted TLS proxy',()=>{
 for(const origin of ['https://yaqeenbiz.com','https://www.yaqeenbiz.com','https://app.yaqeenbiz.com'])
  expect(isSameOriginRequest(request('http://localhost:3000/api',origin,'same-origin'))).toBe(true);
});
it('rejects missing origin, cross-site and sibling-domain requests',()=>{
 expect(isSameOriginRequest(request('http://localhost:3000/api'))).toBe(false);
 for(const site of ['cross-site','same-site','none',undefined])
  expect(isSameOriginRequest(request('http://localhost:3000/api','https://yaqeenbiz.com',site))).toBe(false);
 expect(isSameOriginRequest(request('https://yaqeenbiz.com/api','https://yaqeenbiz.com','cross-site'))).toBe(false);
});
it('rejects unknown hosts, HTTP origins and forwarded-header spoofing',()=>{
 for(const origin of ['https://evil.test','https://yaqeenbiz.com.evil.test','http://yaqeenbiz.com'])
  expect(isSameOriginRequest(request('http://localhost:3000/api',origin,'same-origin'))).toBe(false);
 expect(isSameOriginRequest(new Request('http://localhost:3000/api',{headers:{origin:'https://evil.test','x-forwarded-host':'evil.test','x-forwarded-proto':'https'}}))).toBe(false);
});
