import {randomUUID} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {describe,expect,it,vi} from 'vitest';
import {createVerifiedZatcaEnrollmentAuditStore} from './zatca-private-enrollment-audit';
function fixture(){
  const actor=randomUUID(),context={organizationId:randomUUID(),connectionId:randomUUID(),environment:'SIMULATION',enrollmentId:randomUUID(),dispatchId:randomUUID(),checkId:randomUUID(),receiptDigest:'a'.repeat(64)};
  const evidence={stage:'ONBOARDING_CANDIDATE_ONLY',identity:{stage:'ONBOARDING_IDENTITY_PREFLIGHT_ONLY',scope:{organizationId:context.organizationId,connectionId:context.connectionId,unitId:context.connectionId,environment:'SIMULATION'},profile:'ZAKATFLOW_SAN_DIRECTORY_V1',certificateFingerprintSha256:'b'.repeat(64),expectedIdentitySha256:'c'.repeat(64),csrSha256:'d'.repeat(64),publicKeySpkiSha256:'e'.repeat(64)},
    path:{stage:'CERTIFICATE_PATH_CHECK_ONLY',environment:'SIMULATION',certificateFingerprintSha256:'b'.repeat(64),anchorFingerprintSha256:'f'.repeat(64),issuerFingerprintsSha256:['f'.repeat(64)],crlFingerprintsSha256:['1'.repeat(64)],checkedAt:new Date().toISOString(),engine:'OpenSSL 3.0.2'}};
  const reference={version:'ZATCA_INITIAL_CREDENTIAL_V1',secretArn:'arn:aws:secretsmanager:eu-central-1:123456789012:secret:synthetic-ABC123',secretVersionId:context.dispatchId,certificateFingerprintSha256:'b'.repeat(64),encryptionKeyArn:'arn:aws:kms:eu-central-1:123456789012:key/'+randomUUID()};
  const common={check_id:context.checkId,dispatch_id:context.dispatchId,receipt_digest:context.receiptDigest,recorded_by:actor,recorded_at:new Date().toISOString(),integrity_valid:true};
  const state={audit:{...common,evidence,verification_digest:'2'.repeat(64)},handoff:{...common,active_reference:reference,handoff_digest:'3'.repeat(64),state:'COMPLIANCE_PENDING'},findCount:0,snapshotDigest:context.receiptDigest};
  const client=Object.assign(new EventEmitter(),{query:vi.fn(async(sql:string,_params?:unknown[])=>{
    if(sql.includes('lock_response_snapshot'))return {rowCount:1,rows:[{receipt_digest:state.snapshotDigest}]};
    if(sql.includes('record_response_verification'))return {rowCount:1,rows:[structuredClone(state.audit)]};
    if(sql.includes('record_initial_credential_handoff'))return {rowCount:1,rows:[structuredClone(state.handoff)]};
    if(sql.includes('from zatca_preparation.response_verification_audit'))return {rowCount:state.findCount,rows:[structuredClone(state.audit)]};
    return {rowCount:0,rows:[]};
  }),release:vi.fn(),end:vi.fn(async()=>{})});
  const auth={getUser:vi.fn(async(_jwt?:string)=>({data:{user:{id:actor,aud:'authenticated',is_anonymous:false}},error:null}))};
  const store=createVerifiedZatcaEnrollmentAuditStore(auth as never,{connect:async()=>client} as never),{receiptDigest:_digest,...input}=context;
  return {actor,context,input,evidence,reference,state,client,auth,store,record:()=>store.recordVerification('SYNTHETIC.TOKEN',context,evidence),handoff:()=>store.recordCompliancePending('SYNTHETIC.TOKEN',context,reference)};
}
describe('private verification audit and pending-compliance adapters',()=>{
  it('writes exact scoped evidence and validates the receipt before COMMIT',async()=>{
    const f=fixture(),r=await f.record();expect(r.checkId).toBe(f.context.checkId);expect(r.evidence).toEqual(f.evidence);
    const call=f.client.query.mock.calls.find(([s])=>s.includes('record_response_verification'))!;
    expect(call[1]?.slice(0,7)).toEqual([f.context.organizationId,'SIMULATION',f.context.connectionId,f.context.enrollmentId,f.context.dispatchId,f.context.receiptDigest,f.context.checkId]);
    expect(f.client.query.mock.calls.at(-2)?.[0]).toBe('COMMIT');expect(f.client.query.mock.calls.at(-1)?.[0]).toContain("claim.email','',false");
  });
  it('returns a historical audit on lookup or an explicit not-found result',async()=>{
    const f=fixture();expect((await f.store.findVerification('SYNTHETIC.TOKEN',f.input)).audit).toBeNull();f.state.findCount=1;
    const r=await f.store.findVerification('SYNTHETIC.TOKEN',f.input);expect(r.audit?.checkId).toBe(f.context.checkId);expect(r.audit?.recordedBy).toBe(f.actor);
  });
  it('rejects a lookup whose audit no longer matches the authoritative receipt',async()=>{
    const f=fixture();f.state.findCount=1;f.state.snapshotDigest='0'.repeat(64);await expect(f.store.findVerification('SYNTHETIC.TOKEN',f.input)).rejects.toThrow('ENROLLMENT_AUDIT_RECEIPT_INVALID');
  });
  it.each(['secret','binarySecurityToken','otp'])('rejects extra %s in evidence before Auth',async field=>{
    const f=fixture();await expect(f.store.recordVerification('SYNTHETIC.TOKEN',f.context,{...f.evidence,[field]:'PRIVATE'})).rejects.toThrow('ENROLLMENT_AUDIT_INPUT_INVALID');expect(f.auth.getUser).not.toHaveBeenCalled();
  });
  it.each(['check_id','dispatch_id','receipt_digest','integrity_valid','evidence'])('rolls back a corrupted audit %s',async field=>{
    const f=fixture();Object.assign(f.state.audit,{[field]:field==='integrity_valid'?false:field==='evidence'?{...f.evidence,identity:{...f.evidence.identity,csrSha256:'0'.repeat(64)}}:field==='receipt_digest'?'0'.repeat(64):randomUUID()});
    await expect(f.record()).rejects.toThrow('ENROLLMENT_AUDIT_RECEIPT_INVALID');expect(f.client.query.mock.calls.map(([s])=>s)).not.toContain('COMMIT');
  });
  it('returns only the pending-compliance handoff state with the exact opaque version',async()=>{
    const f=fixture(),r=await f.handoff();expect(r.stage).toBe('INITIAL_CREDENTIAL_COMPLIANCE_PENDING_ONLY');expect(r.state).toBe('COMPLIANCE_PENDING');expect(r.activeReference).toEqual(f.reference);
  });
  it.each(['secret','otp','binarySecurityToken'])('rejects extra %s in active reference before Auth',async field=>{
    const f=fixture();await expect(f.store.recordCompliancePending('SYNTHETIC.TOKEN',f.context,{...f.reference,[field]:'PRIVATE'})).rejects.toThrow('ENROLLMENT_HANDOFF_INPUT_INVALID');expect(f.auth.getUser).not.toHaveBeenCalled();
  });
  it('requires the active VersionId to equal the saved dispatch ID',async()=>{
    const f=fixture();f.reference.secretVersionId=randomUUID();await expect(f.handoff()).rejects.toThrow('ENROLLMENT_HANDOFF_INPUT_INVALID');expect(f.auth.getUser).not.toHaveBeenCalled();
  });
  it.each(['state','active_reference','integrity_valid'])('rolls back a corrupted handoff %s',async field=>{
    const f=fixture();Object.assign(f.state.handoff,{[field]:field==='state'?'COMPLIANCE_PASSED':field==='integrity_valid'?false:{...f.reference,certificateFingerprintSha256:'0'.repeat(64)}});
    await expect(f.handoff()).rejects.toThrow('ENROLLMENT_HANDOFF_RECEIPT_INVALID');expect(f.client.query.mock.calls.map(([s])=>s)).not.toContain('COMMIT');
  });
  it.each(['ORGANIZATION_ADMIN_REQUIRED','ENROLLMENT_VERIFICATION_STALE','ENROLLMENT_VERIFICATION_AUDIT_CHANGED','INITIAL_CREDENTIAL_HANDOFF_CHANGED'])('preserves exact private denial %s after rollback',async message=>{
    const f=fixture(),impl=f.client.query.getMockImplementation()!;f.client.query.mockImplementation(async(sql,params)=>{if(sql.includes('record_'))throw Object.assign(new Error(message),{code:'P0001'});return impl(sql,params);});
    await expect(message.startsWith('INITIAL_')?f.handoff():f.record()).rejects.toThrow(message);expect(f.client.release).toHaveBeenCalledWith(false);
  });
  it('sanitizes unknown write diagnostics and discards the failed connection',async()=>{
    const f=fixture();f.client.query.mockRejectedValueOnce(new Error('PRIVATE_PASSWORD'));await expect(f.handoff()).rejects.toThrow('ENROLLMENT_DATABASE_HANDOFF_FAILED');expect(f.client.release).toHaveBeenCalledWith(true);
  });
  it('denies unverified Auth before querying SQL',async()=>{
    const f=fixture();f.auth.getUser.mockRejectedValue(new Error('PRIVATE'));await expect(f.record()).rejects.toThrow('UNAUTHORIZED');expect(f.client.query).not.toHaveBeenCalled();
  });
});
