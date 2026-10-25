import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createZatcaCsr } from '../lib/vat-zatca-csr';
import { createZatcaEnrollmentCoordinator } from './zatca-private-enrollment-coordinator';

const mocks = vi.hoisted(() => ({ load: vi.fn(), claim: vi.fn() }));
vi.mock('./zatca-private-enrollment-reader', () => ({ createVerifiedZatcaEnrollmentReader: () => ({ loadOriginalEnrollment: mocks.load }) }));
vi.mock('./zatca-private-enrollment-dispatch', () => ({ createVerifiedZatcaEnrollmentDispatch: () => ({ claimInitialDispatch: mocks.claim }) }));
const target = { organizationId: randomUUID(), connectionId: randomUUID(), environment: 'SIMULATION' };
const operation = { enrollmentId: randomUUID(), dispatchId: randomUUID() }, token = 'SYNTHETIC.TOKEN';
let original: { enrollmentId: string; enrollmentDigest: string; csrPem: string; savedUnit: Record<string,string> };
beforeAll(async () => {
  const keys = generateKeyPairSync('ec', { namedCurve: 'secp256k1' }), spki = keys.publicKey.export({ type: 'spki', format: 'der' });
  const fields = { environment: 'SIMULATION' as const, commonName: 'Saved EGS', taxpayerVatNumber: '312345678901233', branchName: 'فرع الرياض',
    organizationName: 'شركة اختبار', serialNumber: '1-QA|2-1|3-unit', invoiceType: '1100' as const, registeredAddress: 'الرياض', businessCategory: 'البرمجيات', email: 'qa@example.invalid' };
  const csrPem = await createZatcaCsr(fields, spki, async bytes => sign('sha256', bytes, keys.privateKey));
  const der = Buffer.from(csrPem.replace(/-----[^\n]+-----/g, '').replace(/\s/g, ''), 'base64');
  original = { enrollmentId: operation.enrollmentId, enrollmentDigest: 'a'.repeat(64), csrPem, savedUnit: {
    ...target, unitId: target.connectionId, profile: 'ZAKATFLOW_SAN_DIRECTORY_V1', csrSha256: createHash('sha256').update(der).digest('hex'),
    kmsPublicKeySpkiBase64: spki.toString('base64'), taxpayerVatNumber: fields.taxpayerVatNumber, commonName: fields.commonName,
    branchName: fields.branchName, legalName: fields.organizationName, egsSerialNumber: fields.serialNumber, invoiceType: fields.invoiceType,
    branchLocation: fields.registeredAddress, industry: fields.businessCategory, email: fields.email } };
});
beforeEach(() => { vi.resetAllMocks(); mocks.load.mockImplementation(async () => structuredClone(original)); mocks.claim.mockResolvedValue({ decision: 'FIRST_INTENT_RECORDED', dispatchId: operation.dispatchId }); });
const coordinator = () => createZatcaEnrollmentCoordinator({} as never, {} as never);
describe('saved-original enrollment dispatch coordination preparation', () => {
  it('verifies the real saved signed CSR and derives the claim digest from storage, not caller input', async () => {
    const result = await coordinator().prepareDispatch(token, target, operation);
    expect(result.stage).toBe('ENROLLMENT_COORDINATION_PREPARATION_ONLY'); expect(result.decision).toBe('FIRST_INTENT_RECORDED');
    expect(mocks.load).toHaveBeenCalledWith(token, target); expect(mocks.claim).toHaveBeenCalledWith(token, { ...target, ...operation, enrollmentDigest: original.enrollmentDigest });
    expect(JSON.stringify(result)).not.toContain('CERTIFICATE REQUEST'); expect(JSON.stringify(result)).not.toContain('qa@example.invalid');
  });
  it('propagates reconciliation on replay instead of translating it into readiness to send', async () => {
    mocks.claim.mockResolvedValue({ decision: 'RECONCILIATION_REQUIRED' });
    expect((await coordinator().prepareDispatch(token, target, operation)).decision).toBe('RECONCILIATION_REQUIRED');
  });
  it.each(['otp','csrPem','enrollmentDigest','force','url'])('rejects caller %s in operation inputs before loading anything', async field => {
    await expect(coordinator().prepareDispatch(token, target, { ...operation, [field]: 'override' })).rejects.toThrow('ENROLLMENT_COORDINATION_INPUT_INVALID');
    expect(mocks.load).not.toHaveBeenCalled(); expect(mocks.claim).not.toHaveBeenCalled();
  });
  it('rejects another original enrollment ID without claiming an intent', async () => {
    await expect(coordinator().prepareDispatch(token, target, { ...operation, enrollmentId: randomUUID() })).rejects.toThrow('ENROLLMENT_COORDINATION_ORIGIN_MISMATCH');
    expect(mocks.claim).not.toHaveBeenCalled();
  });
  it('rejects corrupt original CSR material without consuming an intent', async () => {
    mocks.load.mockResolvedValue({ ...original, csrPem: 'invalid' });
    await expect(coordinator().prepareDispatch(token, target, operation)).rejects.toThrow('ORIGINAL_CSR_INVALID'); expect(mocks.claim).not.toHaveBeenCalled();
  });
  it('denies a revoked permission at the fresh claim even after a successful read', async () => {
    mocks.claim.mockRejectedValue(new Error('ORGANIZATION_ADMIN_REQUIRED'));
    await expect(coordinator().prepareDispatch(token, target, operation)).rejects.toThrow('ORGANIZATION_ADMIN_REQUIRED');
  });
  it.each(['load','claim'])('sanitizes an unexpected %s boundary failure', async step => {
    mocks[step as 'load'|'claim'].mockRejectedValue(new Error('PRIVATE_TOKEN_PASSWORD'));
    await expect(coordinator().prepareDispatch(token, target, operation)).rejects.toThrow('ENROLLMENT_COORDINATION_FAILED');
    if (step === 'load') expect(mocks.claim).not.toHaveBeenCalled();
  });
  it('captures immutable operation inputs before the read yields', async () => {
    const op = { ...operation }, scope = { ...target }; let resume!: () => void;
    mocks.load.mockImplementationOnce(async () => { await new Promise<void>(r => { resume = r; }); return structuredClone(original); });
    const pending = coordinator().prepareDispatch(token, scope, op); op.dispatchId = randomUUID(); scope.organizationId = randomUUID(); resume();
    await pending; expect(mocks.claim).toHaveBeenCalledWith(token, { ...target, ...operation, enrollmentDigest: original.enrollmentDigest });
  });
});
