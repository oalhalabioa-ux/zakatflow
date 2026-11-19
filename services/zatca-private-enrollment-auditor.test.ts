import {randomUUID} from 'node:crypto';
import {beforeEach,describe,expect,it,vi} from 'vitest';
import {createVerifiedZatcaEnrollmentAuditor} from './zatca-private-enrollment-auditor';
const mocks=vi.hoisted(()=>({verify:vi.fn(),find:vi.fn(),record:vi.fn()}));
vi.mock('./zatca-private-enrollment-verifier',()=>({createVerifiedZatcaEnrollmentVerifier:()=>({verifySavedResponse:mocks.verify})}));
vi.mock('./zatca-private-enrollment-audit',()=>({createVerifiedZatcaEnrollmentAuditStore:()=>({findVerification:mocks.find,recordVerification:mocks.record})}));
const input={organizationId:randomUUID(),connectionId:randomUUID(),environment:'SIMULATION',enrollmentId:randomUUID(),dispatchId:randomUUID(),checkId:randomUUID()};
const audit={checkId:input.checkId,dispatchId:input.dispatchId,receiptDigest:'a'.repeat(64),verificationDigest:'b'.repeat(64),recordedAt:'2026-10-25T10:00:00.000Z'};
const factory=()=>createVerifiedZatcaEnrollmentAuditor({} as never,{} as never,{} as never,{});
beforeEach(()=>{vi.resetAllMocks();mocks.find.mockResolvedValue({audit:null});mocks.verify.mockResolvedValue({receiptDigest:audit.receiptDigest,evidence:{stage:'ONBOARDING_CANDIDATE_ONLY'}});mocks.record.mockResolvedValue(audit);});
describe('fresh verification to immutable audit with historical recovery',()=>{
  it('runs the protected verifier then the freshly authorized audit writer',async()=>{
    const r=await factory().verifyAndRecord('SYNTHETIC.TOKEN',input);expect(r.stage).toBe('VERIFIED_RESPONSE_AUDIT_RECORDED_ONLY');
    const {checkId:_check,...target}=input;expect(mocks.verify).toHaveBeenCalledWith('SYNTHETIC.TOKEN',target);
    expect(mocks.record).toHaveBeenCalledWith('SYNTHETIC.TOKEN',{...input,receiptDigest:audit.receiptDigest},{stage:'ONBOARDING_CANDIDATE_ONLY'});
  });
  it('recovers a prior operation without refreshing its timestamp or re-running cloud/native verification',async()=>{
    mocks.find.mockResolvedValue({audit});const r=await factory().verifyAndRecord('SYNTHETIC.TOKEN',input);expect(r).toEqual({...audit,stage:'VERIFICATION_AUDIT_REPLAY_ONLY'});expect(mocks.verify).not.toHaveBeenCalled();expect(mocks.record).not.toHaveBeenCalled();
  });
  it.each(['evidence','receiptDigest','activeReference','force'])('rejects caller %s before storage access',async field=>{
    await expect(factory().verifyAndRecord('SYNTHETIC.TOKEN',{...input,[field]:'override'})).rejects.toThrow('ENROLLMENT_AUDIT_INPUT_INVALID');expect(mocks.find).not.toHaveBeenCalled();
  });
  it.each(['lostCommit','competingCheck'])('reconciles %s only through a freshly authorized saved audit',async mode=>{
    mocks.record.mockRejectedValue(new Error(mode==='lostCommit'?'ENROLLMENT_DATABASE_AUDIT_WRITE_FAILED':'ENROLLMENT_VERIFICATION_AUDIT_CHANGED'));
    mocks.find.mockResolvedValueOnce({audit:null}).mockResolvedValueOnce({audit});expect((await factory().verifyAndRecord('SYNTHETIC.TOKEN',input)).stage).toBe('VERIFICATION_AUDIT_REPLAY_ONLY');expect(mocks.find).toHaveBeenCalledTimes(2);
  });
  it('does not conceal a failed write when no committed audit exists',async()=>{
    mocks.record.mockRejectedValue(new Error('PRIVATE_PASSWORD'));await expect(factory().verifyAndRecord('SYNTHETIC.TOKEN',input)).rejects.toThrow('ENROLLMENT_AUDIT_COORDINATION_FAILED');
  });
  it('rejects recovery against another authoritative receipt',async()=>{
    mocks.record.mockRejectedValue(new Error('ENROLLMENT_DATABASE_AUDIT_WRITE_FAILED'));mocks.find.mockResolvedValueOnce({audit:null}).mockResolvedValueOnce({audit:{...audit,receiptDigest:'changed'}});
    await expect(factory().verifyAndRecord('SYNTHETIC.TOKEN',input)).rejects.toThrow('ENROLLMENT_AUDIT_SNAPSHOT_CHANGED');
  });
  it('denies membership revocation at the write/recovery boundary',async()=>{
    mocks.record.mockRejectedValue(new Error('ORGANIZATION_ADMIN_REQUIRED'));mocks.find.mockResolvedValueOnce({audit:null}).mockRejectedValueOnce(new Error('ORGANIZATION_ADMIN_REQUIRED'));
    await expect(factory().verifyAndRecord('SYNTHETIC.TOKEN',input)).rejects.toThrow('ORGANIZATION_ADMIN_REQUIRED');
  });
  it('captures the operation before asynchronous lookup',async()=>{
    const scope={...input};let resume!:()=>void;mocks.find.mockImplementationOnce(async()=>{await new Promise<void>(r=>{resume=r;});return {audit:null};});
    const pending=factory().verifyAndRecord('SYNTHETIC.TOKEN',scope);scope.checkId=randomUUID();resume();expect((await pending).checkId).toBe(input.checkId);
  });
});
