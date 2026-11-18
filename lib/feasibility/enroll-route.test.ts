import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ server: vi.fn(), sameOrigin: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ supabaseServer: mocks.server }));
vi.mock('@/lib/request-origin', () => ({ isSameOriginRequest: mocks.sameOrigin }));
import { POST } from '../../app/api/feasibility/enroll/route';

const request = () => new Request('https://yaqeen.test/api/feasibility/enroll', { method: 'POST' });
const rpc = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('NEXT_PUBLIC_FEASIBILITY_STUDIES', 'true');
  vi.stubEnv('FEASIBILITY_SELF_SERVE', 'true');
  mocks.sameOrigin.mockReturnValue(true);
  mocks.server.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: 'signed-in-user' } }, error: null }) },
    rpc,
  });
  rpc.mockResolvedValue({ error: null });
});

afterEach(() => vi.unstubAllEnvs());

describe('personal feasibility enrollment', () => {
  it('accepts only the authenticated RPC identity', async () => {
    expect((await POST(request())).status).toBe(204);
    expect(rpc).toHaveBeenCalledWith('start_personal_feasibility_trial');
  });

  it('keeps enrollment disabled during the compatibility rollout', async () => {
    vi.stubEnv('FEASIBILITY_SELF_SERVE', 'false');
    expect((await POST(request())).status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects foreign origin and unverified accounts', async () => {
    mocks.sameOrigin.mockReturnValueOnce(false);
    expect((await POST(request())).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValueOnce({ error: { code: '42501' } });
    expect(await (await POST(request())).json()).toEqual({ error: 'FEASIBILITY_VERIFIED_ACCOUNT_REQUIRED' });
  });
});
