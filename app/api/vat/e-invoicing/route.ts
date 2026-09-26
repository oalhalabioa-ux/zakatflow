import { CreateKeyCommand, GetPublicKeyCommand, KMSClient, SignCommand } from '@aws-sdk/client-kms';
import { CreateSecretCommand, PutSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { awsCredentialsProvider } from '@vercel/oidc-aws-credentials-provider';
import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { requireUser } from '@/services/auth';
import { requireOrganizationAdmin, requireOrganizationMember } from '@/services/organization-access';
import { createZatcaCsr, zatcaEgsSerialNumber } from '@/lib/vat-zatca-csr';

export const runtime = 'nodejs';

type Environment = 'SIMULATION' | 'PRODUCTION';

function awsKmsClient() {
  const roleArn = process.env.AWS_ROLE_ARN;
  const region = process.env.AWS_REGION;
  if (!roleArn || !region) throw new Error('AWS_KMS_NOT_CONFIGURED');
  return new KMSClient({ region, credentials: awsCredentialsProvider({ roleArn }) });
}

function awsSecretsClient() {
  const roleArn = process.env.AWS_ROLE_ARN;
  const region = process.env.AWS_REGION;
  if (!roleArn || !region) throw new Error('AWS_KMS_NOT_CONFIGURED');
  return new SecretsManagerClient({ region, credentials: awsCredentialsProvider({ roleArn }) });
}

function requiredText(value: unknown, max: number) {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max
    ? value.trim()
    : null;
}

function statusFor(error: unknown) {
  const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
  if (message === 'UNAUTHORIZED') return 401;
  if (message === 'ORGANIZATION_ADMIN_REQUIRED' || message === 'ORGANIZATION_ACCESS_REQUIRED') return 403;
  if (message === 'AWS_KMS_NOT_CONFIGURED' || message === 'AWS_ROLE_PERMISSION_REQUIRED') return 503;
  if (message === 'FATOORA_REQUEST_TIMEOUT') return 504;
  if (message === 'EINVOICE_REQUEST_FAILED') return 500;
  if (message === 'FATOORA_COMPLIANCE_REQUEST_FAILED') return 502;
  if (message === 'VAT_PROFILE_REQUIRED' || message === 'VAT_REGISTRATION_REQUIRED') return 409;
  if (message === 'EINVOICE_SETUP_ALREADY_EXISTS' || message === 'EINVOICE_SETUP_LOCKED' || message === 'COMPLIANCE_ALREADY_REQUESTED') return 409;
  return 400;
}

function safeErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  const knownCodes = new Set([
    'UNAUTHORIZED', 'ORGANIZATION_ADMIN_REQUIRED', 'ORGANIZATION_ACCESS_REQUIRED',
    'AWS_KMS_NOT_CONFIGURED', 'AWS_ROLE_PERMISSION_REQUIRED', 'VAT_PROFILE_REQUIRED',
    'VAT_REGISTRATION_REQUIRED', 'EINVOICE_SETUP_ALREADY_EXISTS', 'EINVOICE_SETUP_LOCKED', 'COMPLIANCE_ALREADY_REQUESTED',
    'INVALID_EINVOICE_SETUP', 'INVALID_EINVOICE_OTP', 'VAT_NUMBER_MISMATCH',
    'EINVOICE_SETUP_REQUIRED', 'USER_EMAIL_REQUIRED',
  ]);
  if (knownCodes.has(message)) return message;
  const name = typeof error === 'object' && error && 'name' in error ? String((error as { name?: unknown }).name) : '';
  if (/AccessDenied|CredentialsProvider/.test(name)) return 'AWS_ROLE_PERMISSION_REQUIRED';
  if (name === 'AbortError' || name === 'TimeoutError') return 'FATOORA_REQUEST_TIMEOUT';
  return 'EINVOICE_REQUEST_FAILED';
}

export async function GET(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const organizationId = new URL(request.url).searchParams.get('organization_id');
    if (!organizationId) return NextResponse.json({ error: 'ORGANIZATION_ID_REQUIRED' }, { status: 400 });
    const membership = await requireOrganizationMember(supabase, user.id, organizationId);
    const isAdmin = ['OWNER', 'ADMIN'].includes(membership.role);
    const [{ data: profile, error: profileError }, { data: connections, error }] = await Promise.all([
      supabase.from('vat_profiles').select('registration_status,tax_registration_number').eq('organization_id', organizationId).maybeSingle(),
      isAdmin ? supabase.from('vat_einvoice_connections')
        .select('id,organization_id,environment,status,taxpayer_vat_number,common_name,legal_name,branch_name,branch_location,industry,egs_serial_number,invoice_type,last_error_code,created_at,updated_at,kms_key_arn,credentials_secret_arn')
        .eq('organization_id', organizationId)
        .order('environment') : Promise.resolve({ data: [], error: null }),
    ]);
    if (profileError) throw profileError;
    if (error) throw error;
    return NextResponse.json({
      available: profile?.registration_status === 'REGISTERED',
      is_admin: isAdmin,
      connections: (connections ?? []).map((connection: any) => ({
        id: connection.id,
        organization_id: connection.organization_id,
        environment: connection.environment,
        status: connection.status,
        taxpayer_vat_number: connection.taxpayer_vat_number,
        common_name: connection.common_name,
        legal_name: connection.legal_name,
        branch_name: connection.branch_name,
        branch_location: connection.branch_location,
        industry: connection.industry,
        invoice_type: connection.invoice_type,
        last_error_code: connection.last_error_code,
        created_at: connection.created_at,
        updated_at: connection.updated_at,
        can_edit_setup: (
          ['KEY_READY', 'ERROR'].includes(connection.status) && !connection.credentials_secret_arn
        ) || (
          !connection.kms_key_arn && !connection.credentials_secret_arn && ['NOT_CONFIGURED', 'ERROR'].includes(connection.status)
        ),
      })),
    });
  } catch (error) {
    const code = safeErrorCode(error);
    return NextResponse.json({ error: code }, { status: statusFor(new Error(code)) });
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const body = await request.json();
    const organizationId = requiredText(body.organization_id, 64);
    const environment = body.environment as Environment;
    const taxpayerVatNumber = requiredText(body.taxpayer_vat_number, 20);
    const commonName = requiredText(body.common_name, 120);
    const legalName = requiredText(body.legal_name, 200);
    const branchName = requiredText(body.branch_name, 120);
    const branchLocation = requiredText(body.branch_location, 200);
    const industry = requiredText(body.industry, 120);
    const invoiceType = body.invoice_type;
    if (body.action === 'onboard_simulation') {
      const connectionId = requiredText(body.connection_id, 64);
      const otp = typeof body.otp === 'string' ? body.otp.trim() : '';
      if (!organizationId || !connectionId || !/^\d{6}$/.test(otp)) {
        return NextResponse.json({ error: 'INVALID_EINVOICE_OTP' }, { status: 400 });
      }
      await requireOrganizationAdmin(supabase, user.id, organizationId);
      const { data: connection, error } = await supabase.from('vat_einvoice_connections')
        .select('id,environment,status,taxpayer_vat_number,common_name,legal_name,branch_name,branch_location,industry,egs_serial_number,invoice_type,kms_key_arn,credentials_secret_arn')
        .eq('id', connectionId)
        .eq('organization_id', organizationId)
        .single();
      if (error) throw error;
      if (connection.environment !== 'SIMULATION' || !connection.kms_key_arn) throw new Error('EINVOICE_SETUP_REQUIRED');
      if (connection.credentials_secret_arn || connection.status !== 'KEY_READY') throw new Error('COMPLIANCE_ALREADY_REQUESTED');
      if (!user.email) throw new Error('USER_EMAIL_REQUIRED');
      const { data: profile, error: profileError } = await supabase.from('vat_profiles')
        .select('registration_status,tax_registration_number').eq('organization_id', organizationId).maybeSingle();
      if (profileError) throw profileError;
      if (profile?.registration_status !== 'REGISTERED' || profile.tax_registration_number?.trim() !== connection.taxpayer_vat_number) {
        throw new Error('VAT_REGISTRATION_REQUIRED');
      }

      const kms = awsKmsClient();
      const { PublicKey } = await kms.send(new GetPublicKeyCommand({ KeyId: connection.kms_key_arn }));
      if (!PublicKey) throw new Error('AWS_KMS_PUBLIC_KEY_UNAVAILABLE');
      const csrPem = await createZatcaCsr({
        environment: 'SIMULATION',
        commonName: connection.common_name,
        taxpayerVatNumber: connection.taxpayer_vat_number,
        branchName: connection.branch_name,
        organizationName: connection.legal_name,
        serialNumber: connection.egs_serial_number,
        invoiceType: connection.invoice_type,
        registeredAddress: connection.branch_location,
        businessCategory: connection.industry,
        email: user.email,
      }, Buffer.from(PublicKey), async (requestInfoDer) => {
        const result = await kms.send(new SignCommand({
          KeyId: connection.kms_key_arn!,
          Message: requestInfoDer,
          MessageType: 'RAW',
          SigningAlgorithm: 'ECDSA_SHA_256',
        }));
        if (!result.Signature) throw new Error('AWS_KMS_CSR_SIGNATURE_FAILED');
        return Buffer.from(result.Signature);
      });

      const zatcaResponse = await fetch('https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation/compliance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept-Version': 'V2', OTP: otp },
        body: JSON.stringify({ csr: Buffer.from(csrPem, 'utf8').toString('base64') }),
        cache: 'no-store',
        signal: AbortSignal.timeout(20_000),
      });
      const result = await zatcaResponse.json().catch(() => null);
      if (!zatcaResponse.ok || typeof result?.binarySecurityToken !== 'string' || typeof result?.secret !== 'string') {
        await supabase.from('vat_einvoice_connections').update({ last_error_code: 'FATOORA_COMPLIANCE_REQUEST_FAILED', updated_at: new Date().toISOString() }).eq('id', connection.id);
        return NextResponse.json({ error: 'FATOORA_COMPLIANCE_REQUEST_FAILED' }, { status: 502 });
      }

      const secrets = awsSecretsClient();
      const secretName = `zakatflow/fatoora/${organizationId}/simulation/${connection.id}`;
      let secretArn: string | undefined;
      try {
        const secret = await secrets.send(new CreateSecretCommand({
          Name: secretName,
          Description: 'ZakatFlow FATOORA simulation credentials; do not expose to clients.',
          SecretString: JSON.stringify({ binarySecurityToken: result.binarySecurityToken, secret: result.secret }),
          Tags: [
            { Key: 'application', Value: 'zakatflow' },
            { Key: 'organization_id', Value: organizationId },
            { Key: 'environment', Value: 'simulation' },
          ],
        }));
        secretArn = secret.ARN;
      } catch (secretError: any) {
        if (secretError?.name !== 'ResourceExistsException') throw secretError;
        const previous = await secrets.send(new PutSecretValueCommand({
          SecretId: secretName,
          SecretString: JSON.stringify({ binarySecurityToken: result.binarySecurityToken, secret: result.secret }),
        }));
        secretArn = previous.ARN;
      }
      if (!secretArn) throw new Error('AWS_CREDENTIAL_SECRET_CREATION_FAILED');
      const { error: updateError } = await supabase.from('vat_einvoice_connections')
        .update({ status: 'COMPLIANCE_PENDING', credentials_secret_arn: secretArn, last_error_code: null, updated_at: new Date().toISOString() })
        .eq('id', connection.id);
      if (updateError) throw updateError;
      await supabase.from('audit_logs').insert({
        user_id: user.id,
        entity_type: 'vat_einvoice_connection',
        entity_id: connection.id,
        action: 'SIMULATION_CSID_REQUESTED',
        new_data: { environment: 'SIMULATION', status: 'COMPLIANCE_PENDING' },
      });
      return NextResponse.json({ id: connection.id, environment: 'SIMULATION', status: 'COMPLIANCE_PENDING' }, { status: 202, headers: { 'Cache-Control': 'no-store' } });
    }

    if (!organizationId || !['SIMULATION', 'PRODUCTION'].includes(environment) || !taxpayerVatNumber || !/^3\d{13}3$/.test(taxpayerVatNumber) || !commonName || !legalName || !branchName || !branchLocation || !industry || !['1000', '0100', '1100'].includes(invoiceType)) {
      return NextResponse.json({ error: 'INVALID_EINVOICE_SETUP' }, { status: 400 });
    }

    await requireOrganizationAdmin(supabase, user.id, organizationId);
    const { data: profile, error: profileError } = await supabase.from('vat_profiles')
      .select('registration_status,tax_registration_number').eq('organization_id', organizationId).maybeSingle();
    if (profileError) throw profileError;
    if (!profile) throw new Error('VAT_PROFILE_REQUIRED');
    if (profile.registration_status !== 'REGISTERED') throw new Error('VAT_REGISTRATION_REQUIRED');
    if (profile.tax_registration_number?.trim() !== taxpayerVatNumber) {
      return NextResponse.json({ error: 'VAT_NUMBER_MISMATCH' }, { status: 400 });
    }

    const { data: existing, error: existingError } = await supabase.from('vat_einvoice_connections')
      .select('id,kms_key_arn,status,credentials_secret_arn').eq('organization_id', organizationId).eq('environment', environment).maybeSingle();
    if (existingError) throw existingError;
    const editingReadySetup = Boolean(existing?.kms_key_arn && ['KEY_READY', 'ERROR'].includes(existing.status) && !existing.credentials_secret_arn);
    if (existing?.credentials_secret_arn || (existing?.kms_key_arn && !editingReadySetup)) {
      return NextResponse.json({ error: 'EINVOICE_SETUP_LOCKED' }, { status: 409 });
    }

    if (environment !== 'SIMULATION') return NextResponse.json({ error: 'PRODUCTION_ONBOARDING_LOCKED' }, { status: 409 });

    const values = {
      organization_id: organizationId,
      environment,
      status: editingReadySetup ? 'KEY_READY' : 'NOT_CONFIGURED',
      taxpayer_vat_number: taxpayerVatNumber,
      common_name: commonName,
      legal_name: legalName,
      branch_name: branchName,
      branch_location: branchLocation,
      industry,
      egs_serial_number: zatcaEgsSerialNumber(),
      invoice_type: invoiceType,
      kms_key_arn: editingReadySetup ? existing!.kms_key_arn : null,
      last_error_code: null,
      updated_at: new Date().toISOString(),
    };
    const query = existing
      ? supabase.from('vat_einvoice_connections').update(values).eq('id', existing.id)
      : supabase.from('vat_einvoice_connections').insert({ ...values, created_by: user.id });
    if (editingReadySetup) {
      const { data, error } = await query.select('id,organization_id,environment,status,taxpayer_vat_number,common_name,legal_name,branch_name,branch_location,industry,egs_serial_number,invoice_type,last_error_code,created_at,updated_at').single();
      if (error) throw error;
      await supabase.from('audit_logs').insert({
        user_id: user.id,
        entity_type: 'vat_einvoice_connection',
        entity_id: data.id,
        action: 'SETUP_UPDATED',
        new_data: { environment, common_name: commonName, branch_name: branchName, status: data.status },
      });
      return NextResponse.json({ ...data, can_edit_setup: true }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
    }
    const { data: connection, error } = await query.select('id').single();
    if (error) throw error;
    const kms = awsKmsClient();
    const key = await kms.send(new CreateKeyCommand({
      Description: `ZakatFlow e-invoicing signing key (${environment}) for organization ${organizationId}`,
      KeyUsage: 'SIGN_VERIFY',
      KeySpec: 'ECC_SECG_P256K1',
      Origin: 'AWS_KMS',
      MultiRegion: false,
      Tags: [
        { TagKey: 'application', TagValue: 'zakatflow' },
        { TagKey: 'organization_id', TagValue: organizationId },
        { TagKey: 'environment', TagValue: environment.toLowerCase() },
      ],
    }));
    if (!key.KeyMetadata?.Arn) throw new Error('AWS_KMS_KEY_CREATION_FAILED');
    const { data, error: updateError } = await supabase.from('vat_einvoice_connections')
      .update({ kms_key_arn: key.KeyMetadata.Arn, status: 'KEY_READY', updated_at: new Date().toISOString() })
      .eq('id', connection.id)
      .select('id,organization_id,environment,status,taxpayer_vat_number,common_name,legal_name,branch_name,branch_location,industry,egs_serial_number,invoice_type,last_error_code,created_at,updated_at')
      .single();
    if (updateError) throw updateError;
    await supabase.from('audit_logs').insert({
      user_id: user.id,
      entity_type: 'vat_einvoice_connection',
      entity_id: data.id,
      action: 'KEY_CREATED',
      new_data: { organization_id: organizationId, environment, status: 'KEY_READY' },
    });
    return NextResponse.json({ ...data, can_edit_setup: true }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const code = safeErrorCode(error);
    return NextResponse.json({ error: code }, { status: statusFor(new Error(code)) });
  }
}
