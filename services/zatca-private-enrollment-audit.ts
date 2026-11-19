import type { SupabaseClient } from '@supabase/supabase-js';
import type { Pool } from 'pg';
import { z } from 'zod';
import { createVerifiedEnrollmentSession, enrollmentTokenSchema, enrollmentFailure as fail } from './zatca-private-session';

const uuid=z.string().uuid(),pin=z.string().regex(/^[a-f0-9]{64}$/);
const scopeSchema=z.object({organizationId:uuid,connectionId:uuid,unitId:uuid,environment:z.enum(['SIMULATION','PRODUCTION'])}).strict();
export const zatcaResponseVerificationEvidenceSchema=z.object({stage:z.literal('ONBOARDING_CANDIDATE_ONLY'),
  identity:z.object({stage:z.literal('ONBOARDING_IDENTITY_PREFLIGHT_ONLY'),scope:scopeSchema,profile:z.literal('ZAKATFLOW_SAN_DIRECTORY_V1'),
    certificateFingerprintSha256:pin,expectedIdentitySha256:pin,csrSha256:pin,publicKeySpkiSha256:pin}).strict(),
  path:z.object({stage:z.literal('CERTIFICATE_PATH_CHECK_ONLY'),environment:z.enum(['SIMULATION','PRODUCTION']),certificateFingerprintSha256:pin,
    anchorFingerprintSha256:pin,issuerFingerprintsSha256:z.array(pin).min(1).max(5),crlFingerprintsSha256:z.array(pin).min(1).max(6),
    checkedAt:z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/).refine(v=>Number.isFinite(Date.parse(v))),
    engine:z.string().regex(/^OpenSSL 3\.[0-9]+\.[0-9]+$/)}).strict(),
}).strict();
const inputSchema=z.object({organizationId:uuid,connectionId:uuid,environment:z.enum(['SIMULATION','PRODUCTION']),enrollmentId:uuid,dispatchId:uuid,checkId:uuid}).strict();
const writeContextSchema=inputSchema.extend({receiptDigest:pin}).strict();
export const zatcaInitialCredentialReferenceSchema=z.object({version:z.literal('ZATCA_INITIAL_CREDENTIAL_V1'),secretArn:z.string().min(20).max(2048),secretVersionId:uuid,
  certificateFingerprintSha256:pin,encryptionKeyArn:z.string().regex(/^arn:aws:kms:[a-z0-9-]+:[0-9]{12}:key\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/)}).strict();
const recordedFields={dispatch_id:uuid,check_id:uuid,receipt_digest:pin,recorded_by:uuid,recorded_at:z.string().refine(v=>Number.isFinite(Date.parse(v))),integrity_valid:z.literal(true)};
const auditSchema=z.object({...recordedFields,evidence:zatcaResponseVerificationEvidenceSchema,verification_digest:pin}).strict();
const handoffSchema=z.object({...recordedFields,active_reference:zatcaInitialCredentialReferenceSchema,handoff_digest:pin,state:z.literal('COMPLIANCE_PENDING')}).strict();
const auditSelect="select a.check_id,a.dispatch_id,a.receipt_digest,a.evidence,a.verification_digest,a.recorded_by,a.recorded_at::text,"
  +"(a.verification_digest=encode(sha256(convert_to(jsonb_build_object('checkId',a.check_id,'dispatchId',a.dispatch_id,'receiptDigest',a.receipt_digest,'evidence',a.evidence)::text,'UTF8')),'hex')) as integrity_valid ";
const denials=new Set(['UNAUTHORIZED','ORGANIZATION_ADMIN_REQUIRED','EINVOICE_CONNECTION_NOT_FOUND','ORIGINAL_ENROLLMENT_REQUIRED','ENROLLMENT_RESPONSE_ORIGIN_MISMATCH',
  'ENROLLMENT_UNIT_CHANGED','ENROLLMENT_DISPATCH_REQUIRED','ENROLLMENT_RESPONSE_REFERENCE_REQUIRED','ENROLLMENT_RESPONSE_RECEIPT_CHANGED','ENROLLMENT_VERIFICATION_INPUT_INVALID',
  'ENROLLMENT_VERIFICATION_EVIDENCE_INVALID','ENROLLMENT_VERIFICATION_AUDIT_CHANGED','ENROLLMENT_VERIFICATION_STALE','INITIAL_ENROLLMENT_STATE_REQUIRED',
  'ENROLLMENT_VERIFICATION_REQUIRED','INITIAL_CREDENTIAL_REFERENCE_INVALID','INITIAL_CREDENTIAL_HANDOFF_CHANGED','INITIAL_CREDENTIAL_STATE_CHANGED']);
function auditResult(r:z.infer<typeof auditSchema>){return {stage:'RESPONSE_VERIFICATION_AUDIT_ONLY' as const,checkId:r.check_id,dispatchId:r.dispatch_id,receiptDigest:r.receipt_digest,
  evidence:r.evidence,verificationDigest:r.verification_digest,recordedBy:r.recorded_by,recordedAt:r.recorded_at};}

/** Private consistency writers only. Native evidence must come from the protected
 * verifier and active references from an independently verified AWS promotion.
 * Never bind either to HTTP JSON. Handoff means COMPLIANCE_PENDING, not invoice
 * readiness, certificate-policy/authority approval or signer registry activation.
 */
export function createVerifiedZatcaEnrollmentAuditStore(auth:Pick<SupabaseClient['auth'],'getUser'>,pool:Pick<Pool,'connect'>){
  const run=createVerifiedEnrollmentSession(auth,pool);
  return {
    async findVerification(accessToken:unknown,inputValue:unknown){
      let input:z.infer<typeof inputSchema>,token:string;
      try{input=inputSchema.parse(inputValue);token=enrollmentTokenSchema.parse(accessToken);}catch{return fail('ENROLLMENT_AUDIT_INPUT_INVALID');}
      return run(token,'ENROLLMENT_DATABASE_AUDIT_READ_FAILED',async client=>{
        let snapshot;
        try{snapshot=await client.query("select zatca_preparation.lock_response_snapshot($1,$2,$3,$4,$5,null)->>'receiptDigest' as receipt_digest",[input.organizationId,input.environment,input.connectionId,input.enrollmentId,input.dispatchId]);}
        catch(error){if(error instanceof Error&&'code' in error&&error.code==='P0001'&&denials.has(error.message))fail(error.message);throw error;}
        const digest=snapshot.rowCount===1?pin.safeParse(snapshot.rows[0].receipt_digest):undefined;
        if(!digest?.success)fail('ENROLLMENT_AUDIT_RECEIPT_INVALID');
        const result=await client.query(auditSelect+'from zatca_preparation.response_verification_audit a where a.check_id=$1 and a.dispatch_id=$2',[input.checkId,input.dispatchId]);
        if(result.rowCount===0)return {stage:'NO_RESPONSE_VERIFICATION_AUDIT' as const,audit:null};
        const r=result.rowCount===1?auditSchema.safeParse(result.rows[0]):undefined;
        if(!r?.success||r.data.check_id!==input.checkId||r.data.dispatch_id!==input.dispatchId||r.data.receipt_digest!==digest.data)fail('ENROLLMENT_AUDIT_RECEIPT_INVALID');
        return {stage:'SAVED_RESPONSE_VERIFICATION_AUDIT' as const,audit:auditResult(r.data)};
      });
    },
    async recordVerification(accessToken:unknown,contextValue:unknown,evidenceValue:unknown){
      let context:z.infer<typeof writeContextSchema>,evidence:z.infer<typeof zatcaResponseVerificationEvidenceSchema>,token:string;
      try{context=writeContextSchema.parse(contextValue);evidence=zatcaResponseVerificationEvidenceSchema.parse(evidenceValue);token=enrollmentTokenSchema.parse(accessToken);}catch{return fail('ENROLLMENT_AUDIT_INPUT_INVALID');}
      return run(token,'ENROLLMENT_DATABASE_AUDIT_WRITE_FAILED',async client=>{
        let result;
        try{result=await client.query(auditSelect+'from zatca_preparation.record_response_verification($1,$2,$3,$4,$5,$6,$7,$8::jsonb) a',
          [context.organizationId,context.environment,context.connectionId,context.enrollmentId,context.dispatchId,context.receiptDigest,context.checkId,JSON.stringify(evidence)]);}
        catch(error){if(error instanceof Error&&'code' in error&&error.code==='P0001'&&denials.has(error.message))fail(error.message);throw error;}
        const r=result.rowCount===1?auditSchema.safeParse(result.rows[0]):undefined;
        if(!r?.success||r.data.check_id!==context.checkId||r.data.dispatch_id!==context.dispatchId||r.data.receipt_digest!==context.receiptDigest||JSON.stringify(r.data.evidence)!==JSON.stringify(evidence))fail('ENROLLMENT_AUDIT_RECEIPT_INVALID');
        return auditResult(r.data);
      });
    },
    async recordCompliancePending(accessToken:unknown,contextValue:unknown,activeReferenceValue:unknown){
      let context:z.infer<typeof writeContextSchema>,reference:z.infer<typeof zatcaInitialCredentialReferenceSchema>,token:string;
      try{context=writeContextSchema.parse(contextValue);reference=zatcaInitialCredentialReferenceSchema.parse(activeReferenceValue);token=enrollmentTokenSchema.parse(accessToken);if(reference.secretVersionId!==context.dispatchId)throw new Error();}catch{return fail('ENROLLMENT_HANDOFF_INPUT_INVALID');}
      return run(token,'ENROLLMENT_DATABASE_HANDOFF_FAILED',async client=>{
        let result;
        try{result=await client.query('select a.dispatch_id,a.check_id,a.receipt_digest,a.active_reference,a.handoff_digest,a.state,a.recorded_by,a.recorded_at::text,'
          +"(a.handoff_digest=encode(sha256(convert_to(jsonb_build_object('dispatchId',a.dispatch_id,'checkId',a.check_id,'receiptDigest',a.receipt_digest,'activeReference',a.active_reference)::text,'UTF8')),'hex')) as integrity_valid "
          +'from zatca_preparation.record_initial_credential_handoff($1,$2,$3,$4,$5,$6,$7,$8::jsonb) a',
        [context.organizationId,context.environment,context.connectionId,context.enrollmentId,context.dispatchId,context.receiptDigest,context.checkId,JSON.stringify(reference)]);}
        catch(error){if(error instanceof Error&&'code' in error&&error.code==='P0001'&&denials.has(error.message))fail(error.message);throw error;}
        const r=result.rowCount===1?handoffSchema.safeParse(result.rows[0]):undefined;
        if(!r?.success||r.data.check_id!==context.checkId||r.data.dispatch_id!==context.dispatchId||r.data.receipt_digest!==context.receiptDigest||JSON.stringify(r.data.active_reference)!==JSON.stringify(reference))fail('ENROLLMENT_HANDOFF_RECEIPT_INVALID');
        return {stage:'INITIAL_CREDENTIAL_COMPLIANCE_PENDING_ONLY' as const,checkId:r.data.check_id,dispatchId:r.data.dispatch_id,receiptDigest:r.data.receipt_digest,
          activeReference:r.data.active_reference,handoffDigest:r.data.handoff_digest,state:r.data.state,recordedBy:r.data.recorded_by,recordedAt:r.data.recorded_at};
      });
    },
  };
}
