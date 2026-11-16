export type RecoverySessionClient = {
  auth: {
    exchangeCodeForSession(code: string): Promise<{error: unknown | null}>;
    setSession?(tokens: {access_token: string; refresh_token: string}): Promise<{error: unknown | null}>;
    getSession(): Promise<{data: {session: unknown | null}; error: unknown | null}>;
  };
};

export async function establishRecoverySession(
  client: RecoverySessionClient,
  code?: string | null,
  fragment?: string,
): Promise<{session: unknown | null; error: unknown | null}> {
  // Dashboard invitations use an implicit redirect even though the SSR client
  // normally uses PKCE. Let the SDK validate and persist the supplied session.
  const params = new URLSearchParams((fragment ?? '').replace(/^#/, ''));
  if (params.has('error') || params.has('error_code')) {
    return {session: null, error: new Error('RECOVERY_LINK_INVALID')};
  }
  const access = params.get('access_token'), refresh = params.get('refresh_token');
  if (access || refresh) {
    if (!access || !refresh || code || !client.auth.setSession) {
      return {session: null, error: new Error('RECOVERY_LINK_INVALID')};
    }
    const established = await client.auth.setSession({access_token: access, refresh_token: refresh});
    if (established.error) return {session: null, error: established.error};
  }
  if (code) {
    const exchanged = await client.auth.exchangeCodeForSession(code);
    if (exchanged.error) return {session: null, error: exchanged.error};
  }
  const current = await client.auth.getSession();
  return {session: current.data.session, error: current.error};
}
