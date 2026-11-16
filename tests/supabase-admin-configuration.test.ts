import {afterEach,describe,expect,it,vi} from 'vitest';
import {supabaseAdminConfigured,supabaseAdmin} from '../lib/supabase/server';

afterEach(()=>vi.unstubAllEnvs());
describe('privileged invitation lookup readiness',()=>{
 it.each(['','   '])('fails closed for an empty server key',async key=>{
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY',key);
  expect(supabaseAdminConfigured()).toBe(false);
  await expect(supabaseAdmin()).rejects.toThrow('SUPABASE_SERVICE_ROLE_KEY_NOT_CONFIGURED');
 });
 it('reports only presence, never a secret value',()=>{
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY','isolated-test-placeholder');
  expect(supabaseAdminConfigured()).toBe(true);
 });
});
