import type { SupabaseClient } from '@supabase/supabase-js';
import type { Pool } from 'pg';
import { z } from 'zod';
import { zatcaEnrollmentQuarantineReferenceSchema } from '../lib/zatca-enrollment-response-staging';
import { createVerifiedEnrollmentSession, enrollmentTokenSchema, enrollmentFailure as fail } from './zatca-private-session';

const contextSchema = z.object({ organizationId: z.string().uuid(), connectionId: z.string().uuid(), environment: z.enum(['SIMULATION','PRODUCTION']),
  enrollmentId: z.string().uuid(), enrollmentDigest: z.string().regex(/^[a-f0-9]{64}$/), dispatchId: z.string().uuid(),
}).strict();
const receiptSchema = z.object({ dispatch_id: z.string().uuid(), enrollment_id: z.string().uuid(), enrollment_digest: z.string().regex(/^[a-f0-9]{64}$/),
  reference: zatcaEnrollmentQuarantineReferenceSchema, receipt_digest: z.string().regex(/^[a-f0-9]{64}$/),
  recorded_by: z.string().uuid(), recorded_at: z.string().refine(v => Number.isFinite(Date.parse(v))), integrity_valid: z.literal(true),
}).strict();
const denials = new Set(['UNAUTHORIZED','ORGANIZATION_ADMIN_REQUIRED','EINVOICE_CONNECTION_NOT_FOUND','ORIGINAL_ENROLLMENT_REQUIRED',
  'ENROLLMENT_RESPONSE_ORIGIN_MISMATCH','ENROLLMENT_UNIT_CHANGED','ENROLLMENT_DISPATCH_REQUIRED',
  'ENROLLMENT_RESPONSE_REFERENCE_INVALID','ENROLLMENT_RESPONSE_REFERENCE_CHANGED','INITIAL_ENROLLMENT_STATE_REQUIRED']);

/** Private unverified quarantine-reference persistence only. No AWS/authority
 * transport or credential activation. Reference must come from the protected
 * stager/readback, never HTTP JSON. SQL validates consistency, not AWS storage
 * authenticity, certificate trust or proof of actual authority submission.
 */
export function createVerifiedZatcaEnrollmentResponseStore(auth: Pick<SupabaseClient['auth'], 'getUser'>, pool: Pick<Pool, 'connect'>) {
  const run = createVerifiedEnrollmentSession(auth, pool);
  return {
    async recordResponseReference(accessToken: unknown, contextValue: unknown, referenceValue: unknown) {
      let context: z.infer<typeof contextSchema>, reference: z.infer<typeof zatcaEnrollmentQuarantineReferenceSchema>, token: string;
      try {
        context = contextSchema.parse(contextValue); reference = zatcaEnrollmentQuarantineReferenceSchema.parse(referenceValue);
        token = enrollmentTokenSchema.parse(accessToken);
        if (reference.secretVersionId !== context.dispatchId) throw new Error();
      } catch { return fail('ENROLLMENT_RESPONSE_REFERENCE_INPUT_INVALID'); }
      return run(token, 'ENROLLMENT_DATABASE_RESPONSE_FAILED', async (client) => {
        let result;
        try {
          result = await client.query('select r.dispatch_id,r.enrollment_id,r.enrollment_digest,r.reference,r.receipt_digest,r.recorded_by,r.recorded_at::text,'
            + "(r.receipt_digest=encode(sha256(convert_to(jsonb_build_object('dispatchId',r.dispatch_id,'enrollmentDigest',r.enrollment_digest,'reference',r.reference)::text,'UTF8')),'hex')) as integrity_valid "
            + 'from zatca_preparation.record_enrollment_response_reference($1,$2,$3,$4,$5,$6,$7::jsonb) r',
          [context.organizationId,context.environment,context.connectionId,context.enrollmentId,context.enrollmentDigest,context.dispatchId,JSON.stringify(reference)]);
        } catch (error) {
          if (error instanceof Error && 'code' in error && error.code === 'P0001' && denials.has(error.message)) fail(error.message);
          throw error;
        }
        const parsed = result.rowCount === 1 ? receiptSchema.safeParse(result.rows[0]) : undefined;
        if (!parsed?.success) fail('ENROLLMENT_RESPONSE_RECEIPT_INVALID');
        const r = parsed.data;
        if (r.dispatch_id !== context.dispatchId || r.enrollment_id !== context.enrollmentId || r.enrollment_digest !== context.enrollmentDigest
          || Object.entries(reference).some(([key,value]) => r.reference[key as keyof typeof reference] !== value)) fail('ENROLLMENT_RESPONSE_RECEIPT_INVALID');
        return { stage: 'ENROLLMENT_RESPONSE_REFERENCE_RECORDED_ONLY' as const, dispatchId: r.dispatch_id,
          enrollmentId: r.enrollment_id, enrollmentDigest: r.enrollment_digest, reference: r.reference,
          receiptDigest: r.receipt_digest, recordedBy: r.recorded_by, recordedAt: r.recorded_at };
      });
    },
  };
}
