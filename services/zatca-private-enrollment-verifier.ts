import type { SupabaseClient } from '@supabase/supabase-js';
import type { Pool } from 'pg';
import type { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import type { KMSClient } from '@aws-sdk/client-kms';
import { z } from 'zod';
import { createZatcaEnrollmentResponseStager } from '../lib/zatca-enrollment-response-staging';
import { createVerifiedZatcaEnrollmentReader } from './zatca-private-enrollment-reader';
import { createVerifiedZatcaEnrollmentResponseStore } from './zatca-private-enrollment-response';
import { enrollmentTokenSchema } from './zatca-private-session';

const inputSchema = z.object({ organizationId: z.string().uuid(), connectionId: z.string().uuid(), environment: z.enum(['SIMULATION','PRODUCTION']),
  enrollmentId: z.string().uuid(), dispatchId: z.string().uuid(),
}).strict();
const protectedConfigSchema = z.object({ quarantine: z.unknown(), trust: z.unknown(), pathEvidence: z.unknown() }).strict();
const safe = new Set(['UNAUTHORIZED','ORGANIZATION_ADMIN_REQUIRED','EINVOICE_CONNECTION_NOT_FOUND','ORIGINAL_ENROLLMENT_REQUIRED',
  'ENROLLMENT_UNIT_CHANGED','INITIAL_ENROLLMENT_STATE_REQUIRED','ENROLLMENT_READ_SCOPE_MISMATCH','ENROLLMENT_READ_INTEGRITY_INVALID',
  'ENROLLMENT_RESPONSE_READ_SCOPE_INVALID','ENROLLMENT_RESPONSE_READ_INTEGRITY_INVALID','ENROLLMENT_RESPONSE_REFERENCE_REQUIRED',
  'ENROLLMENT_RESPONSE_VERIFICATION_REFERENCE_INVALID','ENROLLMENT_RESPONSE_VERIFICATION_SCOPE_INVALID','ENROLLMENT_RESPONSE_ORIGINAL_INVALID',
  'ENROLLMENT_RESPONSE_IDENTITY_CHECK_FAILED','ENROLLMENT_RESPONSE_KMS_CHECK_FAILED','ENROLLMENT_RESPONSE_TRUST_CHECK_FAILED',
  'ENROLLMENT_RESPONSE_STORED_REFERENCE_CHANGED','ENROLLMENT_RESPONSE_RECOVERY_REQUIRED','ENROLLMENT_RESPONSE_METADATA_INVALID',
  'ENROLLMENT_RESPONSE_VERSION_INVALID','ENROLLMENT_RESPONSE_CONTENT_INVALID','ENROLLMENT_VERIFICATION_ORIGIN_MISMATCH','ENROLLMENT_VERIFICATION_SNAPSHOT_CHANGED']);

/** Isolated read-only verification coordinator. No HTTP, authority, signing,
 * secret/registry write or activation. Configure trust/CRLs out of band and
 * refresh the protected configuration before it expires. Returned evidence is
 * a point-in-time candidate, never a reusable grant or signer activation.
 */
export function createVerifiedZatcaEnrollmentVerifier(auth: Pick<SupabaseClient['auth'], 'getUser'>, pool: Pick<Pool, 'connect'>,
  clients: { secrets: Pick<SecretsManagerClient,'send'>; kms: Pick<KMSClient,'send'> }, protectedConfig: unknown) {
  let config: z.infer<typeof protectedConfigSchema>;
  try { config = structuredClone(protectedConfigSchema.parse(protectedConfig)); }
  catch { throw new Error('ENROLLMENT_VERIFIER_CONFIG_INVALID'); }
  const reader = createVerifiedZatcaEnrollmentReader(auth,pool), store = createVerifiedZatcaEnrollmentResponseStore(auth,pool);
  const loadOriginal = reader.loadOriginalEnrollment.bind(reader), loadReference = store.loadResponseForVerification.bind(store);
  const stager = createZatcaEnrollmentResponseStager(clients.secrets,config.quarantine);
  const kms = { send: clients.kms.send.bind(clients.kms) } as Pick<KMSClient,'send'>;
  return {
    async verifySavedResponse(accessToken: unknown, inputValue: unknown) {
      let token: string, input: z.infer<typeof inputSchema>;
      try { token = enrollmentTokenSchema.parse(accessToken); input = inputSchema.parse(inputValue); }
      catch { throw new Error('ENROLLMENT_VERIFICATION_INPUT_INVALID'); }
      try {
        const target = { organizationId: input.organizationId, connectionId: input.connectionId, environment: input.environment };
        const original = await loadOriginal(token,target), saved = await loadReference(token,input);
        if (original.enrollmentId !== input.enrollmentId || saved.enrollmentDigest !== original.enrollmentDigest)
          throw new Error('ENROLLMENT_VERIFICATION_ORIGIN_MISMATCH');
        const { stage: _stage, reference, receiptDigest, ...context } = saved;
        const verified = await stager.verifyStoredResponse(context, reference,
          { csrPem: original.csrPem, savedUnit: original.savedUnit, pathEvidence: config.pathEvidence },config.trust,kms);
        // Do not hold database locks across cloud/native operations. Reauthorize
        // and compare the same immutable snapshot after those operations finish.
        const current = await loadReference(token,input);
        if (current.receiptDigest !== receiptDigest || current.enrollmentDigest !== saved.enrollmentDigest || current.kmsKeyArn !== saved.kmsKeyArn
          || Object.entries(reference).some(([key,value]) => current.reference[key as keyof typeof reference] !== value))
          throw new Error('ENROLLMENT_VERIFICATION_SNAPSHOT_CHANGED');
        return { stage: 'AUTHORIZED_STAGED_ENROLLMENT_VERIFICATION_ONLY' as const, context: verified.context,
          reference: verified.reference, evidence: verified.evidence, receiptDigest };
      } catch (error) { throw new Error(error instanceof Error && safe.has(error.message) ? error.message : 'ENROLLMENT_VERIFICATION_FAILED'); }
    },
  };
}
