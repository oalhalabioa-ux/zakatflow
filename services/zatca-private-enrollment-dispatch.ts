import type { SupabaseClient } from '@supabase/supabase-js';
import type { Pool } from 'pg';
import { z } from 'zod';
import { createVerifiedEnrollmentSession, enrollmentTokenSchema, enrollmentFailure as fail } from './zatca-private-session';

const inputSchema = z.object({ organizationId: z.string().uuid(), connectionId: z.string().uuid(),
  environment: z.enum(['SIMULATION', 'PRODUCTION']), enrollmentId: z.string().uuid(),
  enrollmentDigest: z.string().regex(/^[a-f0-9]{64}$/), dispatchId: z.string().uuid(),
}).strict();
const receiptSchema = z.object({ acquired: z.boolean(), dispatch_id: z.string().uuid(), enrollment_id: z.string().uuid(),
  enrollment_digest: z.string().regex(/^[a-f0-9]{64}$/), organization_id: z.string().uuid(), connection_id: z.string().uuid(),
  environment: z.enum(['SIMULATION', 'PRODUCTION']), state: z.literal('INTENT_RECORDED'), recorded_by: z.string().uuid(),
  recorded_at: z.string().refine(value => Number.isFinite(Date.parse(value))),
}).strict();
const denials = new Set(['UNAUTHORIZED','ORGANIZATION_ADMIN_REQUIRED','EINVOICE_CONNECTION_NOT_FOUND','ORIGINAL_ENROLLMENT_REQUIRED',
  'ENROLLMENT_DISPATCH_INPUT_INVALID','ENROLLMENT_DISPATCH_INTEGRITY_INVALID','ENROLLMENT_DISPATCH_DIGEST_MISMATCH',
  'ENROLLMENT_UNIT_CHANGED','ENROLLMENT_DISPATCH_CHANGED','INITIAL_ENROLLMENT_STATE_REQUIRED']);

/** Private, durable one-shot intent fence; no HTTP/authority/AWS caller exists.
 * Only acquired=true after known COMMIT/cleanup permits the future protected
 * coordinator to consider a single transport attempt, after its other checks.
 * A replay always requires reconciliation, never another automatic send.
 * No expiry/reset/reclaim: crash/lost COMMIT acknowledgement may strand an intent
 * without any send. This favors non-duplication, not exactly-once remote delivery.
 * IDs/digest come from the coordinator/saved request, never HTTP overrides.
 */
export function createVerifiedZatcaEnrollmentDispatch(auth: Pick<SupabaseClient['auth'], 'getUser'>, pool: Pick<Pool, 'connect'>) {
  const run = createVerifiedEnrollmentSession(auth, pool);
  return {
    async claimInitialDispatch(accessToken: unknown, inputValue: unknown) {
      let input: z.infer<typeof inputSchema>, token: string;
      try { input = inputSchema.parse(inputValue); token = enrollmentTokenSchema.parse(accessToken); }
      catch { return fail('ENROLLMENT_DISPATCH_INPUT_INVALID'); }
      return run(token, 'ENROLLMENT_DATABASE_DISPATCH_FAILED', async (client, actor) => {
        let result;
        try {
          result = await client.query('select r.acquired,r.dispatch_id,r.enrollment_id,r.enrollment_digest,r.organization_id,'
            + 'r.environment,r.connection_id,r.state,r.recorded_by,r.recorded_at::text '
            + 'from zatca_preparation.claim_initial_enrollment_dispatch($1,$2,$3,$4,$5,$6) r',
          [input.organizationId,input.environment,input.connectionId,input.enrollmentId,input.enrollmentDigest,input.dispatchId]);
        } catch (error) {
          if (error instanceof Error && 'code' in error && error.code === 'P0001' && denials.has(error.message)) fail(error.message);
          throw error;
        }
        const parsed = result.rowCount === 1 ? receiptSchema.safeParse(result.rows[0]) : undefined;
        if (!parsed?.success) fail('ENROLLMENT_DISPATCH_RECEIPT_INVALID');
        const r = parsed.data;
        if (r.dispatch_id !== input.dispatchId || r.enrollment_id !== input.enrollmentId || r.enrollment_digest !== input.enrollmentDigest
          || r.organization_id !== input.organizationId || r.connection_id !== input.connectionId || r.environment !== input.environment
          || (r.acquired && r.recorded_by !== actor)) fail('ENROLLMENT_DISPATCH_RECEIPT_INVALID');
        return { stage: 'ENROLLMENT_DISPATCH_INTENT_ONLY' as const,
          decision: r.acquired ? 'FIRST_INTENT_RECORDED' as const : 'RECONCILIATION_REQUIRED' as const,
          dispatchId: r.dispatch_id, enrollmentId: r.enrollment_id, enrollmentDigest: r.enrollment_digest,
          recordedBy: r.recorded_by, recordedAt: r.recorded_at };
      });
    },
  };
}
