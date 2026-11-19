import type {SupabaseClient} from '@supabase/supabase-js';
import type {Pool} from 'pg';
import type {SecretsManagerClient} from '@aws-sdk/client-secrets-manager';
import type {KMSClient} from '@aws-sdk/client-kms';
import {z} from 'zod';
import {createVerifiedZatcaEnrollmentVerifier} from './zatca-private-enrollment-verifier';
import {createVerifiedZatcaEnrollmentAuditStore} from './zatca-private-enrollment-audit';
import {enrollmentTokenSchema} from './zatca-private-session';
const inputSchema=z.object({organizationId:z.string().uuid(),connectionId:z.string().uuid(),environment:z.enum(['SIMULATION','PRODUCTION']),enrollmentId:z.string().uuid(),dispatchId:z.string().uuid(),checkId:z.string().uuid()}).strict();
const safe=new Set(['UNAUTHORIZED','ORGANIZATION_ADMIN_REQUIRED','EINVOICE_CONNECTION_NOT_FOUND','ORIGINAL_ENROLLMENT_REQUIRED','ENROLLMENT_UNIT_CHANGED','INITIAL_ENROLLMENT_STATE_REQUIRED',
  'ENROLLMENT_RESPONSE_REFERENCE_REQUIRED','ENROLLMENT_RESPONSE_RECEIPT_CHANGED','ENROLLMENT_VERIFICATION_STALE','ENROLLMENT_VERIFICATION_AUDIT_CHANGED','ENROLLMENT_VERIFICATION_EVIDENCE_INVALID',
  'ENROLLMENT_AUDIT_RECEIPT_INVALID','ENROLLMENT_RESPONSE_IDENTITY_CHECK_FAILED','ENROLLMENT_RESPONSE_KMS_CHECK_FAILED','ENROLLMENT_RESPONSE_TRUST_CHECK_FAILED','ENROLLMENT_AUDIT_SNAPSHOT_CHANGED']);
/** Verify with protected native/cloud inputs, then freshly authorize the immutable
 * audit. Exact operation replays recover historical evidence and never refresh
 * its timestamp or grant activation. No secret promotion/handoff is called here.
 */
export function createVerifiedZatcaEnrollmentAuditor(auth:Pick<SupabaseClient['auth'],'getUser'>,pool:Pick<Pool,'connect'>,
  clients:{secrets:Pick<SecretsManagerClient,'send'>;kms:Pick<KMSClient,'send'>},protectedConfig:unknown){
  const verifier=createVerifiedZatcaEnrollmentVerifier(auth,pool,clients,protectedConfig),store=createVerifiedZatcaEnrollmentAuditStore(auth,pool);
  const verify=verifier.verifySavedResponse.bind(verifier),find=store.findVerification.bind(store),record=store.recordVerification.bind(store);
  return {
    async verifyAndRecord(accessToken:unknown,inputValue:unknown){
      let token:string,input:z.infer<typeof inputSchema>;
      try{token=enrollmentTokenSchema.parse(accessToken);input=inputSchema.parse(inputValue);}catch{throw new Error('ENROLLMENT_AUDIT_INPUT_INVALID');}
      try{
        const previous=await find(token,input);
        if(previous.audit)return {...previous.audit,stage:'VERIFICATION_AUDIT_REPLAY_ONLY' as const};
        const {checkId:_checkId,...target}=input,verified=await verify(token,target);
        try{
          const audit=await record(token,{...input,receiptDigest:verified.receiptDigest},verified.evidence);
          return {...audit,stage:'VERIFIED_RESPONSE_AUDIT_RECORDED_ONLY' as const};
        }catch(error){
          // A competing exact operation or lost COMMIT acknowledgement can leave
          // a durable first record. Only a freshly authorized lookup reconciles it.
          const recovered=await find(token,input);
          if(!recovered.audit)throw error;
          if(recovered.audit.receiptDigest!==verified.receiptDigest)throw new Error('ENROLLMENT_AUDIT_SNAPSHOT_CHANGED');
          return {...recovered.audit,stage:'VERIFICATION_AUDIT_REPLAY_ONLY' as const};
        }
      }catch(error){throw new Error(error instanceof Error&&safe.has(error.message)?error.message:'ENROLLMENT_AUDIT_COORDINATION_FAILED');}
    },
  };
}
