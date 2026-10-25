import type { SupabaseClient } from '@supabase/supabase-js';
import type { Pool, PoolClient } from 'pg';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { zatcaSavedUnitIdentitySchema } from '../lib/zatca-onboarding-identity';

const targetSchema = z.object({ organizationId: z.string().uuid(), connectionId: z.string().uuid(),
  environment: z.enum(['SIMULATION', 'PRODUCTION']) }).strict();
const tokenSchema = z.string().min(1).max(16384).regex(/^[\x21-\x7e]+$/);
const verifiedUser = z.object({ id: z.string().uuid(), aud: z.literal('authenticated'),
  is_anonymous: z.literal(false).optional() });
const membershipSchema = z.object({ role: z.enum(['OWNER', 'ADMIN']), status: z.literal('ACTIVE') }).strict();
const connectionSchema = z.object({ id: z.string().uuid(), organization_id: z.string().uuid(),
  environment: z.enum(['SIMULATION', 'PRODUCTION']), unit_stamp: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const enrollmentSchema = z.object({ enrollment_id: z.string().uuid(), organization_id: z.string().uuid(),
  environment: z.enum(['SIMULATION', 'PRODUCTION']), connection_id: z.string().uuid(),
  unit_stamp: z.string().regex(/^[a-f0-9]{64}$/), enrollment_digest: z.string().regex(/^[a-f0-9]{64}$/),
  csr_der_base64: z.string().min(4).max(32768).regex(/^[A-Za-z0-9+/]+={0,2}$/),
  expected_identity: zatcaSavedUnitIdentitySchema, integrity_valid: z.literal(true),
}).strict();

class ReadFailure extends Error {}
function fail(code: string): never { throw new ReadFailure(code); }
const clearIdentity = "select set_config('request.jwt.claim.sub','',false),set_config('request.jwt.claims','',false)";

/** Private backend read boundary, not an HTTP route or an issuance authority.
 * The auth client must target the protected deployment's Supabase project; the
 * pool must be dedicated to this private backend, with verified TLS and a scoped
 * DB role capable of the private INVOKER contracts. Never inject either from a
 * request or use an anonymous/service-role JWT as an end user's identity.
 * No production caller exists. Returned CSR/identity are internal, not an API DTO.
 */
export function createVerifiedZatcaEnrollmentReader(
  auth: Pick<SupabaseClient['auth'], 'getUser'>, pool: Pick<Pool, 'connect'>,
) {
  const getUser = auth.getUser.bind(auth), connect = pool.connect.bind(pool);
  return {
    async loadOriginalEnrollment(accessToken: unknown, targetValue: unknown) {
      let target: z.infer<typeof targetSchema>, token: string;
      try { target = targetSchema.parse(targetValue); token = tokenSchema.parse(accessToken); }
      catch { return fail('ENROLLMENT_READ_INPUT_INVALID'); }
      let actor: string;
      try {
        const response = await getUser(token);
        if (response.error || !response.data?.user) throw new Error();
        actor = verifiedUser.parse(response.data.user).id;
      } catch { return fail('UNAUTHORIZED'); }
      // No identity/role is decoded from the token or accepted from request JSON.
      let client: PoolClient;
      try { client = await connect(); }
      catch { return fail('ENROLLMENT_DATABASE_UNAVAILABLE'); }
      let transaction = false, destroy = false, result: {
        stage: 'AUTHORIZED_ENROLLMENT_READ_ONLY'; actorId: string;
        enrollmentId: string; enrollmentDigest: string; csrPem: string;
        savedUnit: z.infer<typeof zatcaSavedUnitIdentitySchema>;
      } | undefined;
      let failure: Error | undefined, connectionFault = false;
      const onError = () => { connectionFault = true; };
      client.on('error', onError);
      try {
        // A dedicated pool should already be clean. Defensively roll back a
        // released unfinished transaction and clear any stale session identity.
        await client.query('ROLLBACK');
        await client.query(clearIdentity);
        await client.query('BEGIN'); transaction = true;
        await client.query("select set_config('lock_timeout','2s',true),set_config('statement_timeout','5s',true),"
          + "set_config('idle_in_transaction_session_timeout','10s',true),set_config('search_path','pg_catalog',true)");
        await client.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",
          [actor, JSON.stringify({ sub: actor, role: 'authenticated' })]);
        const membership = await client.query('select role,status from public.organization_members where organization_id=$1 and user_id=$2 for share',
          [target.organizationId, actor]);
        if (membership.rowCount !== 1 || !membershipSchema.safeParse(membership.rows[0]).success) fail('ORGANIZATION_ADMIN_REQUIRED');
        const connectionResult = await client.query('select c.id,c.organization_id,c.environment,'
          + 'zatca_preparation.enrollment_unit_stamp(to_jsonb(c)) as unit_stamp from public.vat_einvoice_connections c '
          + 'where c.organization_id=$1 and c.id=$2 and c.environment=$3 for share',
        [target.organizationId, target.connectionId, target.environment]);
        if (connectionResult.rowCount !== 1) fail('EINVOICE_CONNECTION_NOT_FOUND');
        const connection = connectionSchema.safeParse(connectionResult.rows[0]);
        if (!connection.success || connection.data.id !== target.connectionId || connection.data.organization_id !== target.organizationId
            || connection.data.environment !== target.environment) fail('ENROLLMENT_READ_SCOPE_MISMATCH');
        const enrollmentResult = await client.query('select e.enrollment_id,e.organization_id,e.environment,e.connection_id,e.unit_stamp,'
          + 'e.enrollment_digest,e.csr_der_base64,e.expected_identity,'
          + "(e.enrollment_digest=encode(sha256(convert_to(jsonb_build_object('enrollmentId',e.enrollment_id,'unitStamp',e.unit_stamp,"
          + "'csrDerBase64',e.csr_der_base64,'expectedIdentity',e.expected_identity)::text,'UTF8')),'hex')) as integrity_valid "
          + 'from zatca_preparation.enrollment_requests e where e.organization_id=$1 and e.connection_id=$2 and e.environment=$3',
        [target.organizationId, target.connectionId, target.environment]);
        if (enrollmentResult.rowCount !== 1) fail('ORIGINAL_ENROLLMENT_REQUIRED');
        const row = enrollmentSchema.safeParse(enrollmentResult.rows[0]);
        if (!row.success) fail('ENROLLMENT_READ_INTEGRITY_INVALID');
        const e = row.data, saved = e.expected_identity;
        if (e.organization_id !== target.organizationId || e.environment !== target.environment || e.connection_id !== target.connectionId
          || saved.organizationId !== target.organizationId || saved.environment !== target.environment
          || saved.connectionId !== target.connectionId || saved.unitId !== target.connectionId) fail('ENROLLMENT_READ_SCOPE_MISMATCH');
        if (e.unit_stamp !== connection.data.unit_stamp) fail('ENROLLMENT_UNIT_CHANGED');
        const csr = Buffer.from(e.csr_der_base64, 'base64');
        if (csr.toString('base64') !== e.csr_der_base64 || createHash('sha256').update(csr).digest('hex') !== saved.csrSha256)
          fail('ENROLLMENT_READ_INTEGRITY_INVALID');
        result = { stage: 'AUTHORIZED_ENROLLMENT_READ_ONLY', actorId: actor,
          enrollmentId: e.enrollment_id, enrollmentDigest: e.enrollment_digest,
          csrPem: '-----BEGIN CERTIFICATE REQUEST-----\n' + e.csr_der_base64.match(/.{1,64}/g)!.join('\n') + '\n-----END CERTIFICATE REQUEST-----\n',
          savedUnit: saved };
        await client.query('COMMIT'); transaction = false;
      } catch (error) {
        failure = error instanceof ReadFailure ? error : new Error('ENROLLMENT_DATABASE_READ_FAILED');
        if (!(error instanceof ReadFailure)) destroy = true;
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
      if (connectionFault || destroy || !result) return fail('ENROLLMENT_DATABASE_READ_FAILED');
      return result;
    },
  };
}
