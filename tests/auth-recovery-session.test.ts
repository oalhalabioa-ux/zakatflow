import {describe, expect, it} from 'vitest';
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
