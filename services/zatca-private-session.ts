import type { SupabaseClient } from '@supabase/supabase-js';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';

export const enrollmentTokenSchema = z.string().min(1).max(16384).regex(/^[\x21-\x7e]+$/);
const verifiedUser = z.object({ id: z.string().uuid(), aud: z.literal('authenticated'),
  is_anonymous: z.literal(false).optional() });
export class EnrollmentSessionFailure extends Error {}
export function enrollmentFailure(code: string): never { throw new EnrollmentSessionFailure(code); }
const clearIdentity = "select pg_catalog.set_config('request.jwt.claim.sub','',false),pg_catalog.set_config('request.jwt.claims','',false),"
  + "pg_catalog.set_config('request.jwt.claim','',false),pg_catalog.set_config('request.jwt.claim.role','',false),pg_catalog.set_config('request.jwt.claim.email','',false)";

/** Private backend only. A dedicated direct/session-mode pool and protected Auth client are required.
 * A write may have committed even if COMMIT acknowledgement or cleanup fails;
 * callers must retry the same immutable operation, never invent a new identifier.
 */
export function createVerifiedEnrollmentSession(auth: Pick<SupabaseClient['auth'], 'getUser'>, pool: Pick<Pool, 'connect'>) {
  const getUser = auth.getUser.bind(auth), connect = pool.connect.bind(pool);
  return async function run<T>(token: string, operationFailure: string, operation: (client: PoolClient, actor: string) => Promise<T>): Promise<T> {
    let actor: string;
    try {
      const response = await getUser(token);
      if (response.error || !response.data?.user) throw new Error();
      actor = verifiedUser.parse(response.data.user).id;
    } catch { return enrollmentFailure('UNAUTHORIZED'); }
    // No identity/role is decoded from the token or accepted from request JSON.
    let client: PoolClient;
    try { client = await connect(); }
    catch { return enrollmentFailure('ENROLLMENT_DATABASE_UNAVAILABLE'); }
    let transaction = false, destroy = false, result: T | undefined;
    let failure: Error | undefined, connectionFault = false;
    const onError = () => { connectionFault = true; };
    client.on('error', onError);
    try {
      // A dedicated pool should already be clean. Defensively roll back a
      // released unfinished transaction and clear any stale session identity.
      await client.query('ROLLBACK');
      await client.query(clearIdentity);
      await client.query('BEGIN'); transaction = true;
      await client.query("select pg_catalog.set_config('lock_timeout','2s',true),pg_catalog.set_config('statement_timeout','5s',true),"
        + "pg_catalog.set_config('idle_in_transaction_session_timeout','10s',true),pg_catalog.set_config('search_path','pg_catalog',true)");
      await client.query("select pg_catalog.set_config('request.jwt.claim.sub',$1,true),pg_catalog.set_config('request.jwt.claims',$2,true),"
        + "pg_catalog.set_config('request.jwt.claim','',true),pg_catalog.set_config('request.jwt.claim.role','authenticated',true),pg_catalog.set_config('request.jwt.claim.email','',true)",
        [actor, JSON.stringify({ sub: actor, role: 'authenticated' })]);
      result = await operation(client, actor);
      await client.query('COMMIT'); transaction = false;
    } catch (error) {
      failure = error instanceof EnrollmentSessionFailure ? error : new Error(operationFailure);
      if (!(error instanceof EnrollmentSessionFailure)) destroy = true;
      if (transaction) {
        try { await client.query('ROLLBACK'); transaction = false; }
        catch { destroy = true; }
      }
    } finally {
      if (connectionFault) destroy = true;
      if (!destroy) {
        try { await client.query(clearIdentity); }
        catch { destroy = true; failure = new Error('ENROLLMENT_DATABASE_CLEANUP_FAILED'); }
      }
      try { client.release(destroy); }
      catch {
        try { await client.end(); } catch { /* already unusable; do not expose native diagnostics */ }
        failure = new Error('ENROLLMENT_DATABASE_CLEANUP_FAILED');
      } finally { client.removeListener('error', onError); }
    }
    if (failure) throw failure;
    if (connectionFault || destroy || !result) return enrollmentFailure(operationFailure);
    return result;
  };
}
