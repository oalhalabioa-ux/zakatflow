import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// A fake AWS executable is the ONLY cloud interface used in these tests.
const fakeAws = `#!/usr/bin/env python3
import json,os,sys
args=sys.argv[1:]; op=' '.join(args[:2]); case=os.environ['QA_PROVISION_CASE']
with open(os.environ['QA_PROVISION_LOG'],'a') as f: f.write(op+'\\n')
def stop(name): print(name,file=sys.stderr);sys.exit(254)
if op=='sts get-caller-identity': print(json.dumps({'Account':'000000000000' if case=='wrong-account' else '701899214938'}))
elif op=='iam get-role':
 if case=='missing-role': stop('NoSuchEntity')
 print(json.dumps({'Role':{'Arn':'arn:aws:iam::701899214938:role/yaqeen-fatoora-qa-preview'}}))
elif op in ['kms describe-key','kms create-key']:
 if op=='kms describe-key' and case in ['new','lost-create']: stop('NotFoundException')
 if op=='kms describe-key' and case=='denied': stop('AccessDeniedException')
 if op=='kms create-key' and case=='lost-create': stop('Unknown network acknowledgement')
 print(json.dumps({'KeyMetadata':{'Arn':'arn:aws:kms:eu-north-1:701899214938:key/11111111-2222-4333-8444-555555555555',
  'KeySpec':'SYMMETRIC_DEFAULT','KeyUsage':'ENCRYPT_DECRYPT','KeyState':'Enabled','KeyManager':'CUSTOMER','Origin':'AWS_KMS'}}))
elif op=='kms list-resource-tags':
 print(json.dumps({'Tags':[{'TagKey':'application','TagValue':'zakatflow'},
  {'TagKey':'purpose','TagValue':'unrelated' if case=='wrong-tags' else 'qa-enrollment-quarantine'}]}))
elif op=='kms create-alias': pass
elif op=='iam get-role-policy':
 if case=='conflicting-policy': print(json.dumps({'PolicyDocument':{'Version':'2012-10-17','Statement':[]}}))
 else: stop('NoSuchEntity')
elif op=='iam put-role-policy':
 path=args[args.index('--policy-document')+1].removeprefix('file://')
 with open(os.environ['QA_PROVISION_POLICY'],'w') as f: f.write(open(path).read())
else: stop('Unexpected cloud action: '+op)
`;

function run(testCase: string) {
  const directory = mkdtempSync(join(tmpdir(), 'zatca-provision-'));
  try {
    writeFileSync(join(directory, 'aws'), fakeAws, { mode: 0o700 });
    const log = join(directory, 'calls'), policy = join(directory, 'policy.json');
    const result = spawnSync('bash', [resolve('scripts/zatca/provision-qa-enrollment.sh')], { encoding: 'utf8',
      env: { ...process.env, PATH: directory + ':' + process.env.PATH, QA_PROVISION_CASE: testCase,
        QA_PROVISION_LOG: log, QA_PROVISION_POLICY: policy } });
    const calls = readFileSync(log, 'utf8').trim().split('\n');
    return { result, calls, policy: result.status === 0 ? JSON.parse(readFileSync(policy, 'utf8')) : null };
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

describe('reviewable AWS QA quarantine provisioning helper', () => {
  it('has valid shell syntax', () => {
    expect(() => execFileSync('bash', ['-n', 'scripts/zatca/provision-qa-enrollment.sh'])).not.toThrow();
  });
  it.each(['new', 'existing'])('configures only the tagged QA quarantine key and separate Simulation policy (%s)', testCase => {
    const { result, calls, policy } = run(testCase);
    expect(result.status, result.stderr).toBe(0);
    expect(calls.filter(c => c === 'kms create-key')).toHaveLength(testCase === 'new' ? 1 : 0);
    expect(calls.filter(c => c === 'kms create-alias')).toHaveLength(testCase === 'new' ? 1 : 0);
    expect(calls.filter(c => c === 'iam put-role-policy')).toHaveLength(1);
    const [secrets, encryption] = policy.Statement;
    expect(secrets.Action).toEqual(['secretsmanager:CreateSecret', 'secretsmanager:TagResource', 'secretsmanager:DescribeSecret', 'secretsmanager:GetSecretValue']);
    expect(secrets.Resource).toBe('arn:aws:secretsmanager:eu-north-1:701899214938:secret:zakatflow/fatoora-enrollment/*/simulation/*');
    expect(encryption.Action).toEqual(['kms:GenerateDataKey', 'kms:Decrypt']);
    expect(encryption.Resource).toBe(JSON.parse(result.stdout).encryptionKeyArn);
    expect(encryption.Condition).toEqual({ StringEquals: { 'kms:ViaService': 'secretsmanager.eu-north-1.amazonaws.com' },
      StringLike: { 'kms:EncryptionContext:SecretARN': secrets.Resource } });
    expect(JSON.parse(result.stdout)).toMatchObject({ stage: 'QA_QUARANTINE_IAM_CONFIGURED_ONLY', authorityRequestSent: false, productionAccessAdded: false });
  });
  it.each(['wrong-account', 'missing-role', 'denied', 'wrong-tags'])('refuses %s without creating a key or modifying a policy', testCase => {
    const { result, calls } = run(testCase);
    expect(result.status).not.toBe(0);
    expect(calls).not.toContain('kms create-key'); expect(calls).not.toContain('iam put-role-policy');
  });
  it('stops after a lost create acknowledgement without retrying, aliasing or granting permissions', () => {
    const { result, calls } = run('lost-create');
    expect(result.status).not.toBe(0);
    expect(calls.filter(c => c === 'kms create-key')).toHaveLength(1);
    expect(calls).not.toContain('kms create-alias'); expect(calls).not.toContain('iam put-role-policy');
  });
  it('does not overwrite a pre-existing inline policy with different contents', () => {
    const { result, calls } = run('conflicting-policy');
    expect(result.status).not.toBe(0); expect(calls).not.toContain('iam put-role-policy');
    expect(result.stderr).toContain('not overwritten');
  });
});
