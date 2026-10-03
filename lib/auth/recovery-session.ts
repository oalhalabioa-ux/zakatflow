export type RecoverySessionClient = {
  auth: {
    exchangeCodeForSession(code: string): Promise<{error: unknown | null}>;
    getSession(): Promise<{data: {session: unknown | null}; error: unknown | null}>;
  };
};

export async function establishRecoverySession(
  client: RecoverySessionClient,
  code?: string | null,
): Promise<{session: unknown | null; error: unknown | null}> {
  if (code) {
    const exchanged = await client.auth.exchangeCodeForSession(code);
    if (exchanged.error) return {session: null, error: exchanged.error};
  }
  const current = await client.auth.getSession();
  return {session: current.data.session, error: current.error};
}
