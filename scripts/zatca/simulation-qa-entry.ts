import { KMSClient } from '@aws-sdk/client-kms';
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { awsCredentialsProvider } from '@vercel/oidc-aws-credentials-provider';
import { getVercelOidcToken } from '@vercel/oidc';
import { createSimulationQa, simulationQaRole } from './simulation-qa';
import { createSimulationQaHttpHandler } from './simulation-qa-http';
import { simulationQaRuntimeEnvironment } from './simulation-qa-runtime';

declare const __YAQEEN_SIMULATION_QA_SOURCE_SHA__: string;

export default createSimulationQaHttpHandler(() => {
  let unit: unknown;
  try { unit = JSON.parse(process.env.FATOORA_QA_SIMULATION_UNIT_PROFILE ?? ''); }
  catch { throw new Error('QA_CONFIGURATION_INVALID'); }
  let standardSample: unknown;
  try { standardSample = process.env.FATOORA_QA_STANDARD_SAMPLE_ADDRESS ? JSON.parse(process.env.FATOORA_QA_STANDARD_SAMPLE_ADDRESS) : undefined; }
  catch { throw new Error('QA_CONFIGURATION_INVALID'); }
  const credentials = awsCredentialsProvider({ roleArn: simulationQaRole });
  return createSimulationQa({
    kms: new KMSClient({ region: 'eu-north-1', credentials, maxAttempts: 1 }),
    secrets: new SecretsManagerClient({ region: 'eu-north-1', credentials, maxAttempts: 1 }),
    transport: fetch,
  }, { unit, encryptionKeyArn: process.env.FATOORA_QA_ENROLLMENT_ENCRYPTION_KEY_ARN,
    sourceSha: __YAQEEN_SIMULATION_QA_SOURCE_SHA__, standardSample,
    proceduralSimplifiedExperiment: process.env.FATOORA_QA_SIMPLIFIED_PROCEDURAL_EXPERIMENT === 'enabled' ? true : undefined });
}, () => simulationQaRuntimeEnvironment(process.env, getVercelOidcToken));
