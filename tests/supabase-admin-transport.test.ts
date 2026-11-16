import {afterEach,describe,it,expect,vi} from 'vitest';
vi.mock('next/headers',()=>({cookies:vi.fn()}));
import {supabaseAdmin} from '../lib/supabase/server';
import {createClient} from '@supabase/supabase-js';
import {ADMIN_HEADER_ERROR,validateAdminHeaders,classifyAdminTransport,adminTransportFromResult} from '../lib/supabase/admin-transport';
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals()});
const configure=(key='fixture-service-key')=>{vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY',key);vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','http://127.0.0.1:54321');vi.stubEnv('NEXT_PUBLIC_APP_ENV','test');};
describe('Supabase administrative transport diagnosis',()=>{
 it('reproduces SDK status zero from invalid headers without any HTTP request',async()=>{
  const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
  const client=createClient('http://127.0.0.1:54321','fake-key\nline',{auth:{persistSession:false,autoRefreshToken:false}});
  const result=await client.from('organization_invitations').select('id').maybeSingle();
  expect(result.status).toBe(0);expect(fetch).not.toHaveBeenCalled();
 });
 it.each(['fixture\nkey','fixture\rkey','fixture🔐key'])('rejects malformed headers with a value-free error',async key=>{
  configure(key);const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
  await expect(supabaseAdmin({diagnoseTransport:true})).rejects.toThrow(ADMIN_HEADER_ERROR);
  expect(fetch).not.toHaveBeenCalled();try{validateAdminHeaders(key);}catch(e){expect(String(e)).not.toContain(key);}
 });
 it.each(['sb_secret_fixture-valid-key','eyJhbGciOiJIUzI1NiJ9.fixture.signature'])('does not infer key authenticity from an acceptable header format',key=>expect(()=>validateAdminHeaders(key)).not.toThrow());
 it.each([['ENOTFOUND','DNS'],['ECONNREFUSED','CONNECTION'],['CERT_HAS_EXPIRED','TLS'],['UND_ERR_CONNECT_TIMEOUT','TIMEOUT']] as const)('preserves safe %s evidence through the actual SDK',async(code,kind)=>{
  configure();vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new TypeError('private-token-must-not-escape',{cause:{code}})));
  const client=await supabaseAdmin({diagnoseTransport:true});const result=await client.from('organization_invitations').select('id').maybeSingle();
  expect(result.status).toBe(0);expect(adminTransportFromResult(result.error!)).toBe(kind);expect(JSON.stringify(result.error)).not.toContain('private-token-must-not-escape');
 });
 it('preserves real HTTP authentication rejection separately from transport failure',async()=>{
  configure();vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({message:'Invalid API key',code:'PGRST301'}),{status:401,headers:{'Content-Type':'application/json'}})));
  const client=await supabaseAdmin({diagnoseTransport:true});const result=await client.from('organization_invitations').select('id').maybeSingle();
  expect(result.status).toBe(401);expect(result.error?.code).toBe('PGRST301');
 });
 it('keeps unknown failures unknown, handles aggregate causes, and never returns raw strings',()=>{
  expect(classifyAdminTransport(new Error('a secret may be here'))).toBe('UNKNOWN');
  expect(classifyAdminTransport({cause:{errors:[{code:'EAI_AGAIN'}]}})).toBe('DNS');
  expect(adminTransportFromResult({message:'unknown-private-error'})).toBe('UNKNOWN');
 });
});
