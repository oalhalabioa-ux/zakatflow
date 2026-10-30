import {beforeEach,describe,expect,it,vi} from 'vitest';
const auth=vi.hoisted(()=>({verifyOtp:vi.fn(),signOut:vi.fn()}));
vi.mock('../lib/supabase/server',()=>({supabaseServer:async()=>({auth,rpc:vi.fn()})}));
import {GET,POST} from '../app/auth/confirm/route';
const base='https://preview.example.test';
const request=(data:Record<string,string>,origin=base)=>new Request(base+'/auth/confirm',{method:'POST',headers:{origin},body:new URLSearchParams(data)});
describe('email confirmation endpoint',()=>{
 beforeEach(()=>vi.clearAllMocks());
 it('does not consume tokens on GET (email scanner protection)',async()=>{const r=await GET(new Request(base+'/auth/confirm?lang=en&type=signup&token_hash=example'));expect(r.status).toBe(200);expect(await r.text()).toContain('method="post"');expect(r.headers.get('Cache-Control')).toContain('no-store');expect(r.headers.get('Referrer-Policy')).toBe('strict-origin');expect(auth.verifyOtp).not.toHaveBeenCalled()});
 for(const locale of ['ar','en'])it(`${locale}: form hides token-bearing referrers without suppressing the browser Origin`,async()=>{const r=await GET(new Request(base+`/auth/confirm?lang=${locale}&type=email&token_hash=example`));expect(r.headers.get('Referrer-Policy')).toBe('strict-origin');expect(r.headers.get('Content-Security-Policy')).toContain("form-action 'self'");expect(await r.text()).toContain(`name="lang" value="${locale}"`)});
 for(const origin of ['null',''])it(`rejects an opaque or missing Origin (${origin}) without consuming a token`,async()=>{expect((await POST(request({type:'email',token_hash:'test'},origin))).status).toBe(403);expect(auth.verifyOtp).not.toHaveBeenCalled()});
 it('escapes token and invite values in HTML',async()=>{const r=await GET(new Request(base+'/auth/confirm?type=email&token_hash=%22%3E%3Cscript%3E'));const html=await r.text();expect(html).not.toContain('value=""><script>');expect(html).toContain('&quot;&gt;&lt;script&gt;')});
 it('rejects cross-origin submissions before calling Auth',async()=>{expect((await POST(request({type:'signup',token_hash:'test'},'https://evil.test'))).status).toBe(403);expect(auth.verifyOtp).not.toHaveBeenCalled()});
 it('does not allow a recovery token to be used as a sign-in token',async()=>{const r=await POST(request({type:'recovery',token_hash:'test'}));expect(r.status).toBe(303);expect(auth.verifyOtp).not.toHaveBeenCalled()});
 it('shows the translated retry screen on an expired signup token',async()=>{auth.verifyOtp.mockResolvedValue({data:{user:null,session:null},error:{code:'otp_expired'}});const r=await POST(request({type:'signup',token_hash:'expired',lang:'en'}));expect(r.headers.get('location')).toBe(base+'/en/login?error=verification')});
 it('verifies through Auth and blocks external redirects',async()=>{auth.verifyOtp.mockResolvedValue({data:{user:{email_confirmed_at:'2026-10-30'},session:{}},error:null});const r=await POST(request({type:'email',token_hash:'test',lang:'en',next:'//evil.test'}));expect(auth.verifyOtp).toHaveBeenCalledWith({token_hash:'test',type:'email'});expect(r.headers.get('location')).toBe(base+'/en/dashboard')});
 it('revokes an unexpectedly unverified session',async()=>{auth.verifyOtp.mockResolvedValue({data:{user:{email_confirmed_at:null},session:{}},error:null});const r=await POST(request({type:'signup',token_hash:'test'}));expect(r.headers.get('location')).toContain('error=verification');expect(auth.signOut).toHaveBeenCalled()});
});
