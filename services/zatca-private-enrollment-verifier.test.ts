import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createVerifiedZatcaEnrollmentVerifier } from './zatca-private-enrollment-verifier';
const mocks = vi.hoisted(() => ({ original: vi.fn(), reference: vi.fn(), verify: vi.fn() }));
vi.mock('./zatca-private-enrollment-reader',()=>({ createVerifiedZatcaEnrollmentReader:()=>({ loadOriginalEnrollment: mocks.original }) }));
vi.mock('./zatca-private-enrollment-response',()=>({ createVerifiedZatcaEnrollmentResponseStore:()=>({ loadResponseForVerification: mocks.reference }) }));
vi.mock('../lib/zatca-enrollment-response-staging',()=>({ createZatcaEnrollmentResponseStager:()=>({ verifyStoredResponse: mocks.verify }) }));
const input = { organizationId: randomUUID(), connectionId: randomUUID(), environment: 'SIMULATION', enrollmentId: randomUUID(), dispatchId: randomUUID() };
const saved = { stage: 'AUTHORIZED_RESPONSE_REFERENCE_READ_ONLY', ...input, enrollmentDigest: 'a'.repeat(64), kmsKeyArn: 'saved-key', receiptDigest: 'b'.repeat(64), reference: { responseSha256: 'c'.repeat(64) } };
const config = { quarantine: { region: 'protected' }, trust: { anchors: ['protected'] }, pathEvidence: { crlsDerBase64: ['protected'] } };
const client = { send: vi.fn() };
const factory = (configuration: unknown = config)=>createVerifiedZatcaEnrollmentVerifier({} as never,{} as never,{ secrets: client, kms: client } as never,configuration);
beforeEach(()=>{
  vi.resetAllMocks(); mocks.original.mockResolvedValue({ enrollmentId: input.enrollmentId, enrollmentDigest: saved.enrollmentDigest, csrPem: 'original-CSR', savedUnit: { organizationId: input.organizationId } });
  mocks.reference.mockImplementation(async()=>structuredClone(saved)); mocks.verify.mockResolvedValue({ evidence: { stage: 'ONBOARDING_CANDIDATE_ONLY' } });
});
describe('private staged enrollment verification orchestration',()=>{
  it('derives private material from saved original/receipt and reauthorizes again after cloud/native checks',async()=>{
    const r = await factory().verifySavedResponse('SYNTHETIC.TOKEN',input); expect(r.stage).toBe('AUTHORIZED_STAGED_ENROLLMENT_VERIFICATION_ONLY'); expect(r.receiptDigest).toBe(saved.receiptDigest);
    expect(mocks.reference).toHaveBeenCalledTimes(2); expect(mocks.verify).toHaveBeenCalledWith({ ...input,enrollmentDigest: saved.enrollmentDigest,kmsKeyArn: saved.kmsKeyArn },saved.reference,
      { csrPem: 'original-CSR', savedUnit: { organizationId: input.organizationId }, pathEvidence: config.pathEvidence },config.trust,expect.any(Object));
    expect(mocks.reference.mock.invocationCallOrder[1]).toBeGreaterThan(mocks.verify.mock.invocationCallOrder[0]); expect(JSON.stringify(r)).not.toContain('original-CSR');
  });
  it.each(['reference','trust','csrPem','kmsKeyArn','enrollmentDigest','force'])('rejects caller %s without reading any stored material',async field=>{
    await expect(factory().verifySavedResponse('SYNTHETIC.TOKEN',{ ...input,[field]:'override' })).rejects.toThrow('ENROLLMENT_VERIFICATION_INPUT_INVALID'); expect(mocks.original).not.toHaveBeenCalled();
  });
  it.each(['enrollmentId','enrollmentDigest'])('rejects an inconsistent original %s before accessing AWS',async field=>{
    mocks.original.mockResolvedValue({ enrollmentId: field === 'enrollmentId' ? randomUUID() : input.enrollmentId, enrollmentDigest: field === 'enrollmentDigest' ? '0'.repeat(64) : saved.enrollmentDigest });
    await expect(factory().verifySavedResponse('SYNTHETIC.TOKEN',input)).rejects.toThrow('ENROLLMENT_VERIFICATION_ORIGIN_MISMATCH'); expect(mocks.verify).not.toHaveBeenCalled();
  });
  it('denies permission revoked during cloud/native verification',async()=>{
    mocks.reference.mockResolvedValueOnce(saved).mockRejectedValueOnce(new Error('ORGANIZATION_ADMIN_REQUIRED'));
    await expect(factory().verifySavedResponse('SYNTHETIC.TOKEN',input)).rejects.toThrow('ORGANIZATION_ADMIN_REQUIRED'); expect(mocks.verify).toHaveBeenCalledTimes(1);
  });
  it.each(['receiptDigest','enrollmentDigest','kmsKeyArn','reference'])('rejects changed final %s instead of returning verified evidence',async field=>{
    mocks.reference.mockResolvedValueOnce(saved).mockResolvedValueOnce({ ...saved,[field]: field === 'reference' ? { responseSha256: 'changed' } : 'changed' });
    await expect(factory().verifySavedResponse('SYNTHETIC.TOKEN',input)).rejects.toThrow('ENROLLMENT_VERIFICATION_SNAPSHOT_CHANGED');
  });
  it.each(['original','reference','verify'])('redacts unexpected %s boundary diagnostics',async step=>{
    mocks[step as keyof typeof mocks].mockRejectedValue(new Error('PRIVATE_CREDENTIAL_PASSWORD'));
    const error = await factory().verifySavedResponse('SYNTHETIC.TOKEN',input).catch(e=>e); expect(error.message).toBe('ENROLLMENT_VERIFICATION_FAILED'); expect(error.cause).toBeUndefined();
  });
  it('captures protected config and scope before asynchronous reads',async()=>{
    const protectedConfig = structuredClone(config), scope = { ...input }, verifier = factory(protectedConfig); let resume!:()=>void;
    mocks.original.mockImplementationOnce(async()=>{ await new Promise<void>(r=>{ resume=r; }); return { enrollmentId: input.enrollmentId,enrollmentDigest:saved.enrollmentDigest,csrPem:'original',savedUnit:{} }; });
    const pending = verifier.verifySavedResponse('SYNTHETIC.TOKEN',scope); scope.organizationId=randomUUID(); protectedConfig.trust.anchors[0]='changed'; resume();
    await pending; expect(mocks.reference).toHaveBeenCalledWith('SYNTHETIC.TOKEN',input); expect(mocks.verify.mock.calls[0][3]).toEqual(config.trust);
  });
  it('rejects extra protected config fields',()=>{ expect(()=>factory({ ...config,endpoint:'https://override.invalid' })).toThrow('ENROLLMENT_VERIFIER_CONFIG_INVALID'); });
});
