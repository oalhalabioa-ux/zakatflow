import { assertSimulationQaTarget, simulationQaRole, simulationQaSigningKey } from './simulation-qa';

/** Read platform identity through the official request-context-aware SDK getter.
 * Never inspect a caller-supplied HTTP header, mutate process.env or cache a token.
 * Build-time VERCEL_OIDC_TOKEN is not a reliable Functions runtime source.
 */
export async function simulationQaRuntimeEnvironment(
  base: Record<string,string|undefined>, getToken: () => Promise<string>,
) {
  if (base.VERCEL_ENV !== 'preview' || base.FATOORA_QA_AWS_REGION !== 'eu-north-1'
    || base.FATOORA_QA_AWS_ROLE_ARN !== simulationQaRole || base.FATOORA_QA_KMS_KEY_ARN !== simulationQaSigningKey)
    throw new Error('QA_TARGET_REQUIRED');
  let token: string;
  try { token = await getToken(); }
  catch { throw new Error('QA_IDENTITY_REQUIRED'); }
  const snapshot = { ...base, VERCEL_OIDC_TOKEN: token };
  assertSimulationQaTarget(snapshot);
  return snapshot;
}
