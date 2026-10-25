import type { SupabaseClient } from '@supabase/supabase-js';
import type { Pool } from 'pg';
import { z } from 'zod';
import { inspectZatcaOriginalCsr } from '../lib/zatca-onboarding-identity';
import { createVerifiedZatcaEnrollmentReader } from './zatca-private-enrollment-reader';
import { createVerifiedZatcaEnrollmentDispatch } from './zatca-private-enrollment-dispatch';
import { enrollmentTokenSchema } from './zatca-private-session';

const targetSchema = z.object({ organizationId: z.string().uuid(), connectionId: z.string().uuid(),
  environment: z.enum(['SIMULATION', 'PRODUCTION']) }).strict();
const operationSchema = z.object({ enrollmentId: z.string().uuid(), dispatchId: z.string().uuid() }).strict();
const safeDenials = new Set(['UNAUTHORIZED','ORGANIZATION_ADMIN_REQUIRED','EINVOICE_CONNECTION_NOT_FOUND',
  'ORIGINAL_ENROLLMENT_REQUIRED','ENROLLMENT_UNIT_CHANGED','ENROLLMENT_READ_SCOPE_MISMATCH','ENROLLMENT_READ_INTEGRITY_INVALID',
  'ENROLLMENT_DISPATCH_CHANGED','ENROLLMENT_DISPATCH_DIGEST_MISMATCH','ENROLLMENT_DISPATCH_INTEGRITY_INVALID',
  'INITIAL_ENROLLMENT_STATE_REQUIRED','ORIGINAL_CSR_INVALID','ENROLLMENT_COORDINATION_ORIGIN_MISMATCH']);

/** Local coordinator preparation only. Reads the preserved original, verifies
 * its CSR, then independently reauthorizes a durable one-shot intent. No OTP,
 * HTTP/authority/AWS transport, secret staging, activation or recovery exists.
 * FIRST_INTENT_RECORDED is not proof of remote submission or fresh KMS ownership.
 * Never expose this as an endpoint or regenerate operation IDs on retries.
 */
export function createZatcaEnrollmentCoordinator(auth: Pick<SupabaseClient['auth'], 'getUser'>, pool: Pick<Pool, 'connect'>) {
  const reader = createVerifiedZatcaEnrollmentReader(auth, pool), fence = createVerifiedZatcaEnrollmentDispatch(auth, pool);
  const load = reader.loadOriginalEnrollment.bind(reader), claim = fence.claimInitialDispatch.bind(fence);
  return {
    async prepareDispatch(accessToken: unknown, targetValue: unknown, operationValue: unknown) {
      let token: string, target: z.infer<typeof targetSchema>, operation: z.infer<typeof operationSchema>;
      try { token = enrollmentTokenSchema.parse(accessToken); target = targetSchema.parse(targetValue); operation = operationSchema.parse(operationValue); }
      catch { throw new Error('ENROLLMENT_COORDINATION_INPUT_INVALID'); }
      try {
        const saved = await load(token, target);
        if (saved.enrollmentId !== operation.enrollmentId) throw new Error('ENROLLMENT_COORDINATION_ORIGIN_MISMATCH');
        inspectZatcaOriginalCsr(saved.csrPem, saved.savedUnit);
        // The database fence rechecks current membership/unit/digest after this
        // read transaction. This is not reuse of a prior authorization decision.
        const receipt = await claim(token, { ...target, enrollmentId: saved.enrollmentId,
          enrollmentDigest: saved.enrollmentDigest, dispatchId: operation.dispatchId });
        return { ...receipt, stage: 'ENROLLMENT_COORDINATION_PREPARATION_ONLY' as const };
      } catch (error) {
        throw new Error(error instanceof Error && safeDenials.has(error.message) ? error.message : 'ENROLLMENT_COORDINATION_FAILED');
      }
    },
  };
}
