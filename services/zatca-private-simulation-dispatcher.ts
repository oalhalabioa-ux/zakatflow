import type { SupabaseClient } from '@supabase/supabase-js';
import type { Pool } from 'pg';
import type { KMSClient } from '@aws-sdk/client-kms';
import type { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { z } from 'zod';
import { createZatcaKmsSigner } from '../lib/zatca-kms-signer';
import { inspectZatcaOriginalCsr } from '../lib/zatca-onboarding-identity';
import { createZatcaSimulationComplianceTransport, simulationOtpSchema } from '../lib/zatca-simulation-compliance';
import { createZatcaEnrollmentResponseStager } from '../lib/zatca-enrollment-response-staging';
import { createVerifiedZatcaEnrollmentReader } from './zatca-private-enrollment-reader';
import { createVerifiedZatcaEnrollmentDispatch } from './zatca-private-enrollment-dispatch';
import { createVerifiedZatcaEnrollmentResponseStore } from './zatca-private-enrollment-response';
import { enrollmentTokenSchema } from './zatca-private-session';

const inputSchema = z.object({ organizationId: z.string().uuid(), connectionId: z.string().uuid(),
  environment: z.literal('SIMULATION'), enrollmentId: z.string().uuid(), dispatchId: z.string().uuid(),
  otp: simulationOtpSchema }).strict();
const quarantineConfigSchema = z.object({ region: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)+$/),
  accountId: z.string().regex(/^[0-9]{12}$/), encryptionKeyArn: z.string().min(1) }).strict();
const safe = new Set(['UNAUTHORIZED', 'ORGANIZATION_ADMIN_REQUIRED', 'EINVOICE_CONNECTION_NOT_FOUND',
  'ORIGINAL_ENROLLMENT_REQUIRED', 'ENROLLMENT_UNIT_CHANGED', 'SIMULATION_ENROLLMENT_ORIGIN_MISMATCH',
  'SIMULATION_ENROLLMENT_KEY_CHECK_FAILED', 'SIMULATION_ENROLLMENT_RECONCILIATION_REQUIRED']);

/** Private orchestration candidate, NOT an HTTP route. Construction requires a
 * protected Auth client, dedicated scoped pool, KMS and quarantine configuration.
 * Uses the preserved original CSR, never regenerates it, claims one durable intent
 * before one fixed Simulation call, then quarantines the response before recording
 * its private reference. Never activates credentials or returns them to a client.
 * No reset/reclaim/auto-retry exists. Missing response/reference means reconciliation.
 */
export function createZatcaPrivateSimulationDispatcher(
  auth: Pick<SupabaseClient['auth'], 'getUser'>, pool: Pick<Pool, 'connect'>,
  clients: { kms: Pick<KMSClient, 'send'>; secrets: Pick<SecretsManagerClient, 'send'>; transport: typeof fetch },
  protectedQuarantineConfig: unknown,
) {
  let quarantine: z.infer<typeof quarantineConfigSchema>;
  try { quarantine = quarantineConfigSchema.parse(protectedQuarantineConfig); }
  catch { throw new Error('SIMULATION_ENROLLMENT_CONFIG_INVALID'); }
  const reader = createVerifiedZatcaEnrollmentReader(auth, pool);
  const fence = createVerifiedZatcaEnrollmentDispatch(auth, pool);
  const store = createVerifiedZatcaEnrollmentResponseStore(auth, pool);
  const stager = createZatcaEnrollmentResponseStager(clients.secrets, quarantine);
  const submit = createZatcaSimulationComplianceTransport(clients.transport);
  const kms = { send: clients.kms.send.bind(clients.kms) } as Pick<KMSClient, 'send'>;
  return {
    async submitOriginal(accessToken: unknown, inputValue: unknown) {
      let token: string, input: z.infer<typeof inputSchema>;
      try { token = enrollmentTokenSchema.parse(accessToken); input = inputSchema.parse(inputValue); }
      catch { throw new Error('SIMULATION_ENROLLMENT_INPUT_INVALID'); }
      let claimAttempted = false;
      try {
        const { otp, enrollmentId, dispatchId, ...target } = input;
        const original = await reader.loadOriginalEnrollment(token, target);
        if (original.enrollmentId !== enrollmentId) throw new Error('SIMULATION_ENROLLMENT_ORIGIN_MISMATCH');
        if (!original.kmsKeyArn.startsWith(`arn:aws:kms:${quarantine.region}:${quarantine.accountId}:key/`)
          || original.kmsKeyArn === quarantine.encryptionKeyArn) throw new Error('SIMULATION_ENROLLMENT_KEY_CHECK_FAILED');
        inspectZatcaOriginalCsr(original.csrPem, original.savedUnit);
        try { await createZatcaKmsSigner(kms, original.kmsKeyArn, Buffer.from(original.savedUnit.kmsPublicKeySpkiBase64, 'base64')); }
        catch { throw new Error('SIMULATION_ENROLLMENT_KEY_CHECK_FAILED'); }
        claimAttempted = true;
        const intent = await fence.claimInitialDispatch(token, { ...target, enrollmentId, dispatchId,
          enrollmentDigest: original.enrollmentDigest });
        if (intent.decision !== 'FIRST_INTENT_RECORDED') throw new Error('SIMULATION_ENROLLMENT_RECONCILIATION_REQUIRED');
        const response = await submit({ environment: 'SIMULATION', csrPem: original.csrPem, otp });
        const context = { ...target, enrollmentId, dispatchId, enrollmentDigest: original.enrollmentDigest, kmsKeyArn: original.kmsKeyArn };
        const staged = await stager.stageResponse(context, response);
        const { kmsKeyArn: _key, ...receiptContext } = context;
        const receipt = await store.recordResponseReference(token, receiptContext, staged.reference);
        return { stage: 'SIMULATION_RESPONSE_QUARANTINED_ONLY' as const,
          enrollmentId, dispatchId, receiptDigest: receipt.receiptDigest, activationAllowed: false as const };
      } catch (error) {
        // A committed claim cannot be reused, even when the authority response or
        // private receipt acknowledgement is lost. Never leak upstream exceptions.
        throw new Error(claimAttempted ? 'SIMULATION_ENROLLMENT_RECONCILIATION_REQUIRED'
          : error instanceof Error && safe.has(error.message) ? error.message : 'SIMULATION_ENROLLMENT_PREPARATION_FAILED');
      }
    },
  };
}
