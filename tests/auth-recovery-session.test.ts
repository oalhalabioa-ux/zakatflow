import {describe, expect, it, vi} from 'vitest';
import {establishRecoverySession} from '../lib/auth/recovery-session';

describe('recovery code exchange contract', () => {
  it('exchanges the code before reading the authenticated recovery session', async () => {
    const calls: string[] = [];
    const client = {
      auth: {
        async exchangeCodeForSession(code: string) {
          calls.push(`exchange:${code}`);
          return {error: null};
        },
        async getSession() {
          calls.push('session');
          return {data: {session: {user: {id: 'qa-user'}}}, error: null};
        },
      },
    };
    const result = await establishRecoverySession(client, 'redacted-code');
    expect(calls).toEqual(['exchange:redacted-code', 'session']);
    expect(result.session).toEqual({user: {id: 'qa-user'}});
    expect(result.error).toBeNull();
  });

  it('does not claim a recovery session when exchange fails', async () => {
    const client = {
      auth: {
        async exchangeCodeForSession() {
          return {error: new Error('invalid code')};
        },
        async getSession() {
          return {data: {session: null}, error: null};
        },
      },
    };
    const result = await establishRecoverySession(client, 'redacted-code');
    expect(result.session).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
  });
});

describe('dashboard invitation session', () => {
  const client = () => ({auth: {
    setSession: vi.fn().mockResolvedValue({error: null}),
    exchangeCodeForSession: vi.fn().mockResolvedValue({error: null}),
    getSession: vi.fn().mockResolvedValue({data: {session: {user: {id: 'invited-user'}}}, error: null}),
  }});
  it('validates implicit invitation tokens with the SDK before reading the session', async () => {
    const c=client();
    const result=await establishRecoverySession(c,null,'#access_token=test-access&refresh_token=test-refresh&type=invite');
    expect(c.auth.setSession).toHaveBeenCalledWith({access_token:'test-access',refresh_token:'test-refresh'});
    expect(c.auth.setSession.mock.invocationCallOrder[0]).toBeLessThan(c.auth.getSession.mock.invocationCallOrder[0]);
    expect(c.auth.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(result.session).toEqual({user:{id:'invited-user'}});
  });
  it('does not accept partial tokens, mixed flows, or an expired link as a ready session', async () => {
    for(const [code,fragment] of [[null,'#access_token=test-access'],['test-code','#access_token=test-access&refresh_token=test-refresh'],[null,'#error=access_denied&error_code=otp_expired']]) {
      const c=client();const result=await establishRecoverySession(c,code,fragment!);
      expect(result.session).toBeNull();expect(result.error).toBeInstanceOf(Error);
      expect(c.auth.setSession).not.toHaveBeenCalled();expect(c.auth.getSession).not.toHaveBeenCalled();
    }
  });
  it('fails closed when the SDK rejects the invitation session', async () => {
    const c=client();c.auth.setSession.mockResolvedValue({error:new Error('invalid session')});
    const result=await establishRecoverySession(c,null,'#access_token=test-access&refresh_token=test-refresh');
    expect(result.session).toBeNull();expect(result.error).toBeInstanceOf(Error);expect(c.auth.getSession).not.toHaveBeenCalled();
  });
});
