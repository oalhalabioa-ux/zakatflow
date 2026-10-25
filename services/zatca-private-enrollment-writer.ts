import type { SupabaseClient } from '@supabase/supabase-js';
import type { Pool } from 'pg';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { inspectZatcaOriginalCsr, zatcaSavedUnitIdentitySchema } from '../lib/zatca-onboarding-identity';
import { createVerifiedEnrollmentSession, enrollmentTokenSchema, enrollmentFailure as fail } from './zatca-private-session';

const targetSchema = z.object({ organizationId: z.string().uuid(), connectionId: z.string().uuid(),
  environment: z.enum(['SIMULATION', 'PRODUCTION']) }).strict();
const requestSchema = z.object({ enrollmentId: z.string().uuid(), csrPem: z.string().min(1).max(32768),
  kmsKeyArn: z.string().regex(/^arn:aws:kms:[a-z0-9-]+:[0-9]{12}:key\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/),
  kmsPublicKeySpkiBase64: z.string().min(4).max(32768).regex(/^[A-Za-z0-9+/]+={0,2}$/),
  email: z.string().email().max(254).regex(/^[\x21-\x7e]+$/),
}).strict();
const memberSchema = z.object({ role: z.enum(['OWNER', 'ADMIN']), status: z.literal('ACTIVE') }).strict();
const savedConnectionSchema = z.object({ id: z.string().uuid(), organization_id: z.string().uuid(),
  environment: z.enum(['SIMULATION', 'PRODUCTION']), kms_key_arn: z.string(),
  taxpayer_vat_number: z.string(), common_name: z.string(), branch_name: z.string(), legal_name: z.string(),
  egs_serial_number: z.string(), invoice_type: z.string(), branch_location: z.string(), industry: z.string(),
}).strict();
const receiptSchema = z.object({ enrollment_id: z.string().uuid(), enrollment_digest: z.string().regex(/^[a-f0-9]{64}$/),
  organization_id: z.string().uuid(), connection_id: z.string().uuid(), environment: z.enum(['SIMULATION', 'PRODUCTION']),
  csr_der_base64: z.string(), expected_identity: zatcaSavedUnitIdentitySchema, recorded_by: z.string().uuid(),
  recorded_at: z.string().refine(value => Number.isFinite(Date.parse(value))), integrity_valid: z.literal(true),
}).strict();
const knownSqlDenials = new Set(['UNAUTHORIZED', 'ORGANIZATION_ADMIN_REQUIRED', 'EINVOICE_CONNECTION_NOT_FOUND',
  'ENROLLMENT_INPUT_INVALID', 'ORIGINAL_ENROLLMENT_CHANGED', 'INITIAL_ENROLLMENT_STATE_REQUIRED']);

/** Internal initial-request persistence candidate. No HTTP or production caller.
 * CSR/SPKI/key ARN must come from a protected coordinator using fresh KMS metadata,
 * never directly from request JSON. This checks CSR consistency, not AWS ownership.
 * Preserve this operation ID and exact original CSR on any ambiguous write retry.
 * It does not submit to the authority, store credentials or activate a signer.
 */
export function createVerifiedZatcaEnrollmentWriter(auth: Pick<SupabaseClient['auth'], 'getUser'>, pool: Pick<Pool, 'connect'>) {
  const run = createVerifiedEnrollmentSession(auth, pool);
  return {
    async preserveOriginalEnrollment(accessToken: unknown, targetValue: unknown, originalValue: unknown) {
      let target: z.infer<typeof targetSchema>, original: z.infer<typeof requestSchema>, token: string;
      try { target = targetSchema.parse(targetValue); original = requestSchema.parse(originalValue); token = enrollmentTokenSchema.parse(accessToken); }
      catch { return fail('ENROLLMENT_WRITE_INPUT_INVALID'); }
      return run(token, 'ENROLLMENT_DATABASE_WRITE_FAILED', async (client, actor) => {
        const membership = await client.query('select role,status from public.organization_members where organization_id=$1 and user_id=$2 for share',
          [target.organizationId, actor]);
        if (membership.rowCount !== 1 || !memberSchema.safeParse(membership.rows[0]).success) fail('ORGANIZATION_ADMIN_REQUIRED');
        const current = await client.query('select c.id,c.organization_id,c.environment,c.kms_key_arn,c.taxpayer_vat_number,'
          + 'c.common_name,c.branch_name,c.legal_name,c.egs_serial_number,c.invoice_type,c.branch_location,c.industry '
          + 'from public.vat_einvoice_connections c where c.organization_id=$1 and c.id=$2 and c.environment=$3 for update',
        [target.organizationId, target.connectionId, target.environment]);
        if (current.rowCount !== 1) fail('EINVOICE_CONNECTION_NOT_FOUND');
        const parsed = savedConnectionSchema.safeParse(current.rows[0]);
        if (!parsed.success) fail('ENROLLMENT_SAVED_UNIT_INVALID');
        const c = parsed.data;
        if (c.id !== target.connectionId || c.organization_id !== target.organizationId || c.environment !== target.environment)
          fail('ENROLLMENT_WRITE_SCOPE_MISMATCH');
        if (c.kms_key_arn !== original.kmsKeyArn) fail('ENROLLMENT_KEY_CHANGED');
        const pem = /^-----BEGIN CERTIFICATE REQUEST-----\r?\n([A-Za-z0-9+/=\r\n]+)\r?\n-----END CERTIFICATE REQUEST-----\r?\n?$/.exec(original.csrPem);
        if (!pem) fail('ORIGINAL_CSR_INVALID');
        const csr = Buffer.from(pem[1].replace(/[\r\n]/g, ''), 'base64');
        const expectedValue = { ...target, unitId: c.id, profile: 'ZAKATFLOW_SAN_DIRECTORY_V1',
          csrSha256: createHash('sha256').update(csr).digest('hex'), kmsPublicKeySpkiBase64: original.kmsPublicKeySpkiBase64,
          taxpayerVatNumber: c.taxpayer_vat_number, commonName: c.common_name, branchName: c.branch_name,
          legalName: c.legal_name, egsSerialNumber: c.egs_serial_number, invoiceType: c.invoice_type,
          branchLocation: c.branch_location, industry: c.industry, email: original.email };
        const expectedResult = zatcaSavedUnitIdentitySchema.safeParse(expectedValue);
        if (!expectedResult.success) fail('ENROLLMENT_SAVED_UNIT_INVALID');
        const expected = expectedResult.data;
        let evidence: ReturnType<typeof inspectZatcaOriginalCsr>;
        try { evidence = inspectZatcaOriginalCsr(original.csrPem, expected); }
        catch { return fail('ORIGINAL_CSR_INVALID'); }
        let persisted;
        try {
          persisted = await client.query('select r.enrollment_id,r.enrollment_digest,r.organization_id,r.connection_id,r.environment,'
            + 'r.csr_der_base64,r.expected_identity,r.recorded_by,r.recorded_at::text,'
            + "(r.enrollment_digest=encode(sha256(convert_to(jsonb_build_object('enrollmentId',r.enrollment_id,'unitStamp',r.unit_stamp,"
            + "'csrDerBase64',r.csr_der_base64,'expectedIdentity',r.expected_identity)::text,'UTF8')),'hex')) as integrity_valid "
            + 'from zatca_preparation.begin_initial_enrollment($1,$2,$3,$4,$5,$6,$7) r',
          [target.organizationId, target.environment, target.connectionId, original.enrollmentId, evidence.csrDerBase64,
            original.kmsPublicKeySpkiBase64, original.email]);
        } catch (error) {
          // Only exact errors from this private contract may cross the boundary.
          if (error instanceof Error && 'code' in error && error.code === 'P0001' && knownSqlDenials.has(error.message)) fail(error.message);
          throw error;
        }
        const receipt = persisted.rowCount === 1 ? receiptSchema.safeParse(persisted.rows[0]) : undefined;
        if (!receipt?.success) fail('ENROLLMENT_WRITE_INTEGRITY_INVALID');
        const r = receipt.data;
        if (r.enrollment_id !== original.enrollmentId || r.organization_id !== target.organizationId
          || r.connection_id !== target.connectionId || r.environment !== target.environment || r.csr_der_base64 !== evidence.csrDerBase64
          || Object.entries(expected).some(([key, value]) => r.expected_identity[key as keyof typeof expected] !== value))
          fail('ENROLLMENT_WRITE_INTEGRITY_INVALID');
        return { stage: 'ORIGINAL_ENROLLMENT_PRESERVED_ONLY' as const, enrollmentId: r.enrollment_id,
          enrollmentDigest: r.enrollment_digest, recordedBy: r.recorded_by, recordedAt: r.recorded_at };
      });
    },
  };
}
