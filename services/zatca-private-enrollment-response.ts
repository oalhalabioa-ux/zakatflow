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
const memberSchema = z.object({ role: z.enum(['OWNER','ADMIN']), status: z.literal('ACTIVE') }).strict();
const readInputSchema = contextSchema.omit({ enrollmentDigest: true });
const connectionSchema = z.object({ id: z.string().uuid(), organization_id: z.string().uuid(), environment: z.enum(['SIMULATION','PRODUCTION']),
  kms_key_arn: z.string().regex(/^arn:aws:kms:[a-z0-9-]+:[0-9]{12}:key\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/),
  status: z.string(), credentials_secret_arn: z.string().nullable(), unit_stamp: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
const loadedReceiptSchema = receiptSchema.extend({ organization_id: z.string().uuid(), connection_id: z.string().uuid(), environment: z.enum(['SIMULATION','PRODUCTION']),
  unit_stamp: z.string().regex(/^[a-f0-9]{64}$/), dispatch_digest: z.string().regex(/^[a-f0-9]{64}$/), original_integrity_valid: z.literal(true),
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
    /** Private short read transaction, not a certificate/activation decision. */
    async loadResponseForVerification(accessToken: unknown, inputValue: unknown) {
      let input: z.infer<typeof readInputSchema>, token: string;
      try { input = readInputSchema.parse(inputValue); token = enrollmentTokenSchema.parse(accessToken); }
      catch { return fail('ENROLLMENT_RESPONSE_READ_INPUT_INVALID'); }
      return run(token, 'ENROLLMENT_DATABASE_RESPONSE_READ_FAILED', async (client, actor) => {
        const member = await client.query('select role,status from public.organization_members where organization_id=$1 and user_id=$2 for share', [input.organizationId,actor]);
        if (member.rowCount !== 1 || !memberSchema.safeParse(member.rows[0]).success)
          fail('ORGANIZATION_ADMIN_REQUIRED');
        const current = await client.query('select c.id,c.organization_id,c.environment,c.kms_key_arn,c.status,c.credentials_secret_arn,'
          + 'zatca_preparation.enrollment_unit_stamp(to_jsonb(c)) as unit_stamp from public.vat_einvoice_connections c '
          + 'where c.organization_id=$1 and c.id=$2 and c.environment=$3 for share', [input.organizationId,input.connectionId,input.environment]);
        if (current.rowCount !== 1) fail('EINVOICE_CONNECTION_NOT_FOUND');
        const parsed = connectionSchema.safeParse(current.rows[0]);
        if (!parsed.success) fail('ENROLLMENT_RESPONSE_READ_INTEGRITY_INVALID');
        const c = parsed.data;
        if (c.id !== input.connectionId || c.organization_id !== input.organizationId || c.environment !== input.environment) fail('ENROLLMENT_RESPONSE_READ_SCOPE_INVALID');
        if (c.status !== 'KEY_READY' || c.credentials_secret_arn !== null) fail('INITIAL_ENROLLMENT_STATE_REQUIRED');
        const result = await client.query('select e.organization_id,e.connection_id,e.environment,e.unit_stamp,e.enrollment_id,e.enrollment_digest,'
          + 'd.dispatch_id,d.enrollment_digest as dispatch_digest,r.reference,r.receipt_digest,r.recorded_by,r.recorded_at::text,'
          + "(e.enrollment_digest=encode(sha256(convert_to(jsonb_build_object('enrollmentId',e.enrollment_id,'unitStamp',e.unit_stamp,'csrDerBase64',e.csr_der_base64,'expectedIdentity',e.expected_identity)::text,'UTF8')),'hex')) as original_integrity_valid,"
          + "(r.receipt_digest=encode(sha256(convert_to(jsonb_build_object('dispatchId',d.dispatch_id,'enrollmentDigest',e.enrollment_digest,'reference',r.reference)::text,'UTF8')),'hex')) as integrity_valid "
          + 'from zatca_preparation.enrollment_requests e join zatca_preparation.enrollment_dispatch_intents d on d.enrollment_id=e.enrollment_id '
          + 'join zatca_preparation.enrollment_response_receipts r on r.dispatch_id=d.dispatch_id '
          + 'where e.organization_id=$1 and e.connection_id=$2 and e.environment=$3 and e.enrollment_id=$4 and d.dispatch_id=$5',
        [input.organizationId,input.connectionId,input.environment,input.enrollmentId,input.dispatchId]);
        if (result.rowCount !== 1) fail('ENROLLMENT_RESPONSE_REFERENCE_REQUIRED');
        const receipt = loadedReceiptSchema.safeParse(result.rows[0]);
        if (!receipt.success) fail('ENROLLMENT_RESPONSE_READ_INTEGRITY_INVALID');
        const r = receipt.data;
        if (r.organization_id !== input.organizationId || r.connection_id !== input.connectionId || r.environment !== input.environment
          || r.enrollment_id !== input.enrollmentId || r.dispatch_id !== input.dispatchId) fail('ENROLLMENT_RESPONSE_READ_SCOPE_INVALID');
        if (r.unit_stamp !== c.unit_stamp) fail('ENROLLMENT_UNIT_CHANGED');
        if (r.dispatch_digest !== r.enrollment_digest || r.reference.secretVersionId !== input.dispatchId) fail('ENROLLMENT_RESPONSE_READ_INTEGRITY_INVALID');
        return { stage: 'AUTHORIZED_RESPONSE_REFERENCE_READ_ONLY' as const, ...input, enrollmentDigest: r.enrollment_digest,
          kmsKeyArn: c.kms_key_arn, reference: r.reference, receiptDigest: r.receipt_digest };
      });
    },
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
