import { GetPublicKeyCommand, SignCommand, type KMSClient } from '@aws-sdk/client-kms';
import { createHash, generateKeyPairSync, sign, verify } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createZatcaKmsSigner, ecdsaDerToXmlSignature } from './zatca-kms-signer';

const arn = 'arn:aws:kms:eu-central-1:123456789012:key/12345678-1234-1234-1234-123456789012';
const payload = Buffer.from('<SignedInfo>synthetic canonical test bytes</SignedInfo>');
function fixture(options: { mismatch?: boolean; corrupt?: boolean; doubleHash?: boolean; metadata?: Record<string, unknown>; response?: Record<string, unknown> } = {}) {
  const pair = generateKeyPairSync('ec', { namedCurve: 'secp256k1' });
  const other = generateKeyPairSync('ec', { namedCurve: 'secp256k1' });
  const spki = pair.publicKey.export({ format: 'der', type: 'spki' });
  const send = vi.fn(async (command: GetPublicKeyCommand | SignCommand) => {
    if (command instanceof GetPublicKeyCommand) return {
      KeyId: arn, KeySpec: 'ECC_SECG_P256K1', KeyUsage: 'SIGN_VERIFY', SigningAlgorithms: ['ECDSA_SHA_256'],
      PublicKey: options.mismatch ? other.publicKey.export({ format: 'der', type: 'spki' }) : spki,
      ...options.metadata,
    };
    // KMS DIGEST signs this SHA256 once; Node signs the original bytes with SHA256.
    expect(Buffer.from(command.input.Message!)).toEqual(createHash('sha256').update(payload).digest());
    expect(command.input).toMatchObject({ KeyId: arn, MessageType: 'DIGEST', SigningAlgorithm: 'ECDSA_SHA_256' });
    return {
      KeyId: arn, SigningAlgorithm: 'ECDSA_SHA_256',
      Signature: sign('sha256', options.doubleHash ? Buffer.from(command.input.Message!) : payload, options.corrupt ? other.privateKey : pair.privateKey),
      ...options.response,
    };
  });
  const client = { send } as unknown as Pick<KMSClient, 'send'>;
  return { client, send, spki, publicKey: pair.publicKey };
}

describe('isolated AWS ZATCA signing primitive', () => {
  it('sends one SHA256 digest and returns an independently verifiable 64-byte XML signature', async () => {
    const f = fixture();
    const signer = await createZatcaKmsSigner(f.client, arn, f.spki);
    const result = await signer.signCanonicalSignedInfo(payload);
    const signature = Buffer.from(result.signatureValue, 'base64');
    expect(signature.length).toBe(64);
    expect(verify('sha256', payload, { key: f.publicKey, dsaEncoding: 'ieee-p1363' }, signature)).toBe(true);
    expect(verify('sha256', Buffer.from('altered'), { key: f.publicKey, dsaEncoding: 'ieee-p1363' }, signature)).toBe(false);
    expect(f.send).toHaveBeenCalledTimes(2);
  });
  it('rejects aliases before contacting AWS', async () => {
    const f = fixture();
    await expect(createZatcaKmsSigner(f.client, 'alias/current', f.spki)).rejects.toThrow('INVALID_KMS_KEY_ARN');
    expect(f.send).not.toHaveBeenCalled();
  });
  it('rejects a different certificate key before signing', async () => {
    const f = fixture({ mismatch: true });
    await expect(createZatcaKmsSigner(f.client, arn, f.spki)).rejects.toThrow('KMS_CERTIFICATE_KEY_MISMATCH');
    expect(f.send).toHaveBeenCalledTimes(1);
  });
  it('rejects the wrong certificate curve before contacting AWS', async () => {
    const f = fixture();
    const wrong = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({ format: 'der', type: 'spki' });
    await expect(createZatcaKmsSigner(f.client, arn, wrong)).rejects.toThrow('INVALID_ZATCA_KEY_CURVE');
    expect(f.send).not.toHaveBeenCalled();
  });
  it.each([
    { KeySpec: 'ECC_NIST_P256' }, { KeyUsage: 'ENCRYPT_DECRYPT' }, { SigningAlgorithms: [] }, { KeyId: 'other' }, { PublicKey: undefined },
  ])('rejects incompatible KMS key metadata %j', async (metadata) => {
    const f = fixture({ metadata });
    await expect(createZatcaKmsSigner(f.client, arn, f.spki)).rejects.toThrow('INVALID_KMS_SIGNING_KEY');
    expect(f.send).toHaveBeenCalledTimes(1);
  });
  it.each([{ corrupt: true }, { doubleHash: true }])('rejects incorrect or double-hashed signatures %j', async (options) => {
    const f = fixture(options);
    const signer = await createZatcaKmsSigner(f.client, arn, f.spki);
    await expect(signer.signCanonicalSignedInfo(payload)).rejects.toThrow('KMS_SIGNATURE_VERIFICATION_FAILED');
  });
  it.each([{ KeyId: 'other' }, { SigningAlgorithm: 'ECDSA_SHA_384' }, { Signature: undefined }])('rejects invalid signing response %j', async (response) => {
    const f = fixture({ response });
    const signer = await createZatcaKmsSigner(f.client, arn, f.spki);
    await expect(signer.signCanonicalSignedInfo(payload)).rejects.toThrow('INVALID_KMS_SIGNATURE_RESPONSE');
  });
  it('rejects empty or oversized SignedInfo without requesting a signature', async () => {
    const f = fixture();
    const signer = await createZatcaKmsSigner(f.client, arn, f.spki);
    for (const bytes of [Buffer.alloc(0), Buffer.alloc(1024 * 1024 + 1)]) await expect(signer.signCanonicalSignedInfo(bytes)).rejects.toThrow('INVALID_SIGNED_INFO_SIZE');
    expect(f.send).toHaveBeenCalledTimes(1);
  });
  it('fails closed on an AWS transport error', async () => {
    const f = fixture();
    const signer = await createZatcaKmsSigner(f.client, arn, f.spki);
    f.send.mockRejectedValueOnce(new Error('AccessDeniedException'));
    await expect(signer.signCanonicalSignedInfo(payload)).rejects.toThrow('AccessDeniedException');
  });
});

describe('strict ECDSA DER conversion', () => {
  it('pads short positive integers and removes required sign padding', () => {
    const der = Buffer.concat([Buffer.from([0x30, 0x26, 0x02, 0x21, 0]), Buffer.alloc(32, 0x80), Buffer.from([0x02, 1, 1])]);
    const raw = ecdsaDerToXmlSignature(der);
    expect(raw.subarray(0, 32)).toEqual(Buffer.alloc(32, 0x80));
    expect(raw.subarray(32)).toEqual(Buffer.concat([Buffer.alloc(31), Buffer.from([1])]));
  });
  it.each(['', '3006020100020101', '3006020180020101', '300702020001020101', '300602010102010100', '308106020101020101', '3006020101020201'])('rejects malformed/noncanonical/zero DER %s', (hex) => {
    expect(() => ecdsaDerToXmlSignature(Buffer.from(hex, 'hex'))).toThrow('INVALID_ECDSA_DER_SIGNATURE');
  });
});
