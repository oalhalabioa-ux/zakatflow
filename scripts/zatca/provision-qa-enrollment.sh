#!/usr/bin/env bash
# Run in the owner's AWS CloudShell. Existing isolated QA account/role only.
# Creates/reuses ONE symmetric quarantine key; adds a scoped inline role policy.
# Does not create credentials, submit a CSR, handle OTP, change signing keys,
# grant Production access, overwrite other policies or configure Vercel/SQL.
set -euo pipefail
export AWS_PAGER=''
export AWS_MAX_ATTEMPTS=1
account='701899214938'
region='eu-north-1'
role='yaqeen-fatoora-qa-preview'
alias_name='alias/yaqeen-fatoora-qa-enrollment-quarantine'
work_dir="$(mktemp -d)"
chmod 700 "$work_dir"
trap 'rm -rf "$work_dir"' EXIT

aws sts get-caller-identity --output json > "$work_dir/identity.json"
python3 - "$work_dir/identity.json" "$account" <<'PY'
import json,sys
if json.load(open(sys.argv[1])).get('Account') != sys.argv[2]:
    raise SystemExit('STOP: sign in to the existing isolated QA AWS account.')
PY
aws iam get-role --role-name "$role" --output json > "$work_dir/role.json"
python3 - "$work_dir/role.json" "$account" "$role" <<'PY'
import json,sys
expected='arn:aws:iam::'+sys.argv[2]+':role/'+sys.argv[3]
if json.load(open(sys.argv[1])).get('Role',{}).get('Arn') != expected:
    raise SystemExit('STOP: existing QA role does not match.')
PY

if aws kms describe-key --region "$region" --key-id "$alias_name" --output json > "$work_dir/key.json" 2> "$work_dir/key-error.txt"; then
  :
else
  key_error="$(cat "$work_dir/key-error.txt")"
  case "$key_error" in
    *NotFoundException*)
      aws kms create-key --region "$region" --key-spec SYMMETRIC_DEFAULT --key-usage ENCRYPT_DECRYPT \
        --description 'Yaqeen isolated QA enrollment response quarantine; no production use' \
        --tags TagKey=application,TagValue=zakatflow TagKey=purpose,TagValue=qa-enrollment-quarantine \
        --output json > "$work_dir/key.json"
      ;;
    *) printf '%s\n' 'STOP: unable to inspect the existing quarantine alias; no key created.' >&2; exit 1 ;;
  esac
fi
key_arn="$(python3 - "$work_dir/key.json" "$account" "$region" <<'PY'
import json,re,sys
m=json.load(open(sys.argv[1])).get('KeyMetadata',{})
prefix='arn:aws:kms:'+sys.argv[3]+':'+sys.argv[2]+':key/'
arn=m.get('Arn','')
if not arn.startswith(prefix) or not re.fullmatch('[a-f0-9-]{36}',arn[len(prefix):]) or any([
    m.get('KeySpec')!='SYMMETRIC_DEFAULT',m.get('KeyUsage')!='ENCRYPT_DECRYPT',
    m.get('KeyState')!='Enabled',m.get('KeyManager')!='CUSTOMER',m.get('Origin')!='AWS_KMS']):
    raise SystemExit('STOP: quarantine key metadata does not match.')
print(arn)
PY
)"
aws kms list-resource-tags --region "$region" --key-id "$key_arn" --output json > "$work_dir/tags.json"
python3 - "$work_dir/tags.json" <<'PY'
import json,sys
tags={t['TagKey']:t['TagValue'] for t in json.load(open(sys.argv[1])).get('Tags',[])}
if tags.get('application')!='zakatflow' or tags.get('purpose')!='qa-enrollment-quarantine':
    raise SystemExit('STOP: quarantine key purpose tags do not match.')
PY
# An alias is added only when it is absent; an existing alias is never repointed.
if [ -n "${key_error:-}" ]; then
  aws kms create-alias --region "$region" --alias-name "$alias_name" --target-key-id "$key_arn"
fi
python3 - "$work_dir/policy.json" "$account" "$region" "$key_arn" <<'PY'
import json,sys
path,account,region,key=sys.argv[1:]
secret='arn:aws:secretsmanager:'+region+':'+account+':secret:zakatflow/fatoora-enrollment/*/simulation/*'
policy={'Version':'2012-10-17','Statement':[
 {'Sid':'SimulationQuarantineOnly','Effect':'Allow',
  'Action':['secretsmanager:CreateSecret','secretsmanager:TagResource','secretsmanager:DescribeSecret','secretsmanager:GetSecretValue'],
  'Resource':secret},
 {'Sid':'QuarantineEnvelopeOnly','Effect':'Allow','Action':['kms:GenerateDataKey','kms:Decrypt'],'Resource':key,
  'Condition':{'StringEquals':{'kms:ViaService':'secretsmanager.'+region+'.amazonaws.com'},
               'StringLike':{'kms:EncryptionContext:SecretARN':secret}}}
]}
with open(path,'w') as f: json.dump(policy,f)
PY
if aws iam get-role-policy --role-name "$role" --policy-name YaqeenQASimulationEnrollmentQuarantine \
  --output json > "$work_dir/existing-policy.json" 2> "$work_dir/policy-error.txt"; then
  python3 - "$work_dir/existing-policy.json" "$work_dir/policy.json" <<'PY'
import json,sys,urllib.parse
existing=json.load(open(sys.argv[1])).get('PolicyDocument')
if isinstance(existing,str): existing=json.loads(urllib.parse.unquote(existing))
if existing != json.load(open(sys.argv[2])):
    raise SystemExit('STOP: an existing inline policy has different contents; it was not overwritten.')
PY
else
  policy_error="$(cat "$work_dir/policy-error.txt")"
  case "$policy_error" in
    *NoSuchEntity*)
      aws iam put-role-policy --role-name "$role" --policy-name YaqeenQASimulationEnrollmentQuarantine \
        --policy-document "file://$work_dir/policy.json"
      ;;
    *) printf '%s\n' 'STOP: unable to inspect the existing inline policy; no policy overwritten.' >&2; exit 1 ;;
  esac
fi
python3 - "$account" "$region" "$key_arn" <<'PY'
import json,sys
print(json.dumps({'stage':'QA_QUARANTINE_IAM_CONFIGURED_ONLY','accountId':sys.argv[1],
 'region':sys.argv[2],'encryptionKeyArn':sys.argv[3],
 'authorityRequestSent':False,'productionAccessAdded':False},indent=2))
PY
