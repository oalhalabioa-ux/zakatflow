import {afterEach,describe,it,expect,vi} from 'vitest';
import {GET,POST} from '../app/auth/email-action/route';
const base='https://preview.example.test';
const verify='https://auth.example.test/auth/v1/verify?token=test&type=email_change&redirect_to='+encodeURIComponent(base+'/auth/callback?lang=en');
afterEach(()=>vi.unstubAllEnvs());
describe('email-change confirmation wrapper',()=>{
 for(const lang of ['ar','en'])it(`${lang}: scanner GET retains token until a native same-origin POST`,async()=>{
 vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://auth.example.test');vi.stubEnv('NEXT_PUBLIC_APP_ENV','test');vi.stubEnv('NEXT_PUBLIC_APP_URL',base);
 const r=await GET(new Request(base+'/auth/email-action?lang='+lang+'&confirmation_url='+encodeURIComponent(verify)));expect(r.status).toBe(200);expect(r.headers.get('Referrer-Policy')).toBe('strict-origin');const html=await r.text();expect(html).toContain(`lang="${lang}"`);expect(html).toContain('method="post"');
 const p=await POST(new Request(base+'/auth/email-action',{method:'POST',headers:{Origin:base},body:new URLSearchParams({lang,confirmation_url:verify})}));expect(p.status).toBe(303);expect(p.headers.get('location')).toBe(verify);
 });
 it.each(['https://evil.test','null',''])('rejects cross-origin or opaque origin %s',async origin=>{vi.stubEnv('NEXT_PUBLIC_APP_URL',base);expect((await POST(new Request(base+'/auth/email-action',{method:'POST',headers:{Origin:origin},body:new URLSearchParams({confirmation_url:verify})}))).status).toBe(403)});
 it.each(['https://evil.test/auth/v1/verify?type=email_change&token=x','https://auth.example.test/auth/v1/verify?type=recovery&token=x','https://auth.example.test/auth/v1/verify?type=email_change&token=x&redirect_to=https://evil.test'])('rejects foreign or wrong-purpose links',async url=>{vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://auth.example.test');vi.stubEnv('NEXT_PUBLIC_APP_URL',base);const r=await GET(new Request(base+'/auth/email-action?lang=en&confirmation_url='+encodeURIComponent(url)));expect(r.status).toBe(303);expect(r.headers.get('location')).toBe(base+'/en/login?error=auth')});
});
