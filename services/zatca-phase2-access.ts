import { z } from 'zod';
import { requireUser } from './auth';
import { requireOrganizationAdmin } from './organization-access';
import { zatcaPreparationScopeSchema } from '../lib/zatca-reserved-preparation';

const targetSchema = z.object({ organizationId: z.string().uuid(), documentId: z.string().uuid(),
  environment: z.enum(['SIMULATION', 'PRODUCTION']) }).strict();
const vat = z.string().regex(/^3[0-9]{13}3$/);
const invoiceSchema = z.object({
  id: z.string().uuid(), organization_id: z.string().uuid(), connection_id: z.string().uuid(),
  invoice_uuid: z.string().uuid(), status: z.literal('DRAFT'), seller_vat_number: vat,
  invoice_category: z.enum(['STANDARD', 'SIMPLIFIED']),
}).strict();
const connectionSchema = z.object({
  id: z.string().uuid(), organization_id: z.string().uuid(),
  environment: z.enum(['SIMULATION', 'PRODUCTION']), status: z.string(), taxpayer_vat_number: vat,
  egs_serial_number: z.string().trim().min(1).max(500), invoice_type: z.enum(['1000', '0100', '1100']),
}).strict();

/** Read-only access preflight, not a reservation/issuance authorization token.
 * Uses the application's verified server session and current database membership.
 * No caller-supplied user, connection, EGS ID, certificate or key is accepted.
 * Recheck permissions/identity inside the future atomic freeze/reserve transaction;
 * these separate reads do NOT freeze source rows or eliminate revocation races.
 * No production route imports this service yet.
 */
export async function checkZatcaPhaseTwoPreparationAccess(targetInput: unknown) {
  const target = targetSchema.parse(targetInput);
  const { supabase, user } = await requireUser();
  const userId = z.string().uuid().parse(user.id);
  await requireOrganizationAdmin(supabase, userId, target.organizationId);
  const invoiceResult = await supabase.from('vat_einvoices')
    .select('id,organization_id,connection_id,invoice_uuid,status,seller_vat_number,invoice_category')
    .eq('organization_id', target.organizationId).eq('id', target.documentId).maybeSingle();
  if (invoiceResult.error) throw new Error('EINVOICE_ACCESS_CHECK_FAILED');
  if (!invoiceResult.data) throw new Error('EINVOICE_DRAFT_NOT_FOUND');
  const invoice = invoiceSchema.parse(invoiceResult.data);
  if (invoice.organization_id !== target.organizationId || invoice.id !== target.documentId) throw new Error('EINVOICE_SOURCE_SCOPE_MISMATCH');
  const connectionResult = await supabase.from('vat_einvoice_connections')
    .select('id,organization_id,environment,status,taxpayer_vat_number,egs_serial_number,invoice_type')
    .eq('organization_id', target.organizationId).eq('id', invoice.connection_id)
    .eq('environment', target.environment).maybeSingle();
  if (connectionResult.error) throw new Error('EINVOICE_ACCESS_CHECK_FAILED');
  if (!connectionResult.data) throw new Error('EINVOICE_CONNECTION_NOT_FOUND');
  const connection = connectionSchema.parse(connectionResult.data);
  if (connection.organization_id !== target.organizationId || connection.id !== invoice.connection_id
      || connection.environment !== target.environment) throw new Error('EINVOICE_CONNECTION_SCOPE_MISMATCH');
  if (connection.status !== (target.environment === 'SIMULATION' ? 'COMPLIANCE_PASSED' : 'CONNECTED')) throw new Error('EINVOICE_CONNECTION_NOT_READY');
  if (connection.taxpayer_vat_number !== invoice.seller_vat_number) throw new Error('SELLER_VAT_MISMATCH');
  const supported = invoice.invoice_category === 'STANDARD' ? ['1000', '1100'] : ['0100', '1100'];
  if (!supported.includes(connection.invoice_type)) throw new Error('EINVOICE_UNIT_CATEGORY_MISMATCH');
  // Current schema models one connection/EGS per organization/environment. Its
  // saved primary key identifies this EGS; never invent or accept another unit ID.
  const scope = zatcaPreparationScopeSchema.parse({ organizationId: target.organizationId,
    environment: target.environment, connectionId: connection.id, unitId: connection.id,
    documentId: invoice.id, invoiceUuid: invoice.invoice_uuid });
  return { stage: 'ACCESS_CHECK_ONLY' as const, scope, sellerVatNumber: invoice.seller_vat_number,
    invoiceCategory: invoice.invoice_category };
}
