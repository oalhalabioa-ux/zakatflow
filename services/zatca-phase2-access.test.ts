import { beforeEach, describe, expect, it, vi } from 'vitest';
const { session } = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock('./auth', () => ({ requireUser: session }));
import { checkZatcaPhaseTwoPreparationAccess } from './zatca-phase2-access';

const org = 'a800b1c2-df4a-4a79-9b91-4a451ce2858a', id = 'a800b1c2-df4a-4a79-9b91-4a451ce2858b';
const connectionId = 'a800b1c2-df4a-4a79-9b91-4a451ce2858c', userId = 'a800b1c2-df4a-4a79-9b91-4a451ce2858d';
const other = 'a800b1c2-df4a-4a79-9b91-4a451ce2858e';
const target = { organizationId: org, documentId: id, environment: 'SIMULATION' };
function fixture() {
  const rows: Record<string, { data: unknown; error: unknown }> = {
    organization_members: { data: { role: 'ADMIN', status: 'ACTIVE' }, error: null },
    vat_einvoices: { data: { id, organization_id: org, connection_id: connectionId, invoice_uuid: other,
      status: 'DRAFT', seller_vat_number: '312345678901233', invoice_category: 'STANDARD' }, error: null },
    vat_einvoice_connections: { data: { id: connectionId, organization_id: org, environment: 'SIMULATION',
      status: 'COMPLIANCE_PASSED', taxpayer_vat_number: '312345678901233', egs_serial_number: 'SYNTHETIC-EGS', invoice_type: '1100' }, error: null },
  };
  const calls: { table: string; columns: string; filters: [string, unknown][] }[] = [];
  const from = vi.fn((table: string) => {
    const call = { table, columns: '', filters: [] as [string, unknown][] }; calls.push(call);
    const query = { select: (columns: string) => { call.columns = columns; return query; },
      eq: (key: string, value: unknown) => { call.filters.push([key, value]); return query; },
      maybeSingle: async () => rows[table] };
    return query;
  });
  session.mockResolvedValue({ user: { id: userId, user_metadata: { role: 'OWNER' } }, supabase: { from } });
  return { rows, calls, from, change(table: string, patch: Record<string, unknown>) {
    rows[table].data = { ...(rows[table].data as object), ...patch };
  } };
}
beforeEach(() => { session.mockReset(); });

describe('verified-session preparation access preflight', () => {
  it.each(['OWNER', 'ADMIN'])('accepts an active %s and derives scope from saved rows', async role => {
    const f = fixture(); f.change('organization_members', { role });
    const result = await checkZatcaPhaseTwoPreparationAccess(target);
    expect(result).toEqual({ stage: 'ACCESS_CHECK_ONLY', scope: { ...target, connectionId,
      unitId: connectionId, invoiceUuid: other }, sellerVatNumber: '312345678901233', invoiceCategory: 'STANDARD' });
    expect(f.calls.map(c => c.table)).toEqual(['organization_members', 'vat_einvoices', 'vat_einvoice_connections']);
    expect(f.calls[0].filters).toEqual([['organization_id', org], ['user_id', userId]]);
    expect(f.calls[1].filters).toEqual([['organization_id', org], ['id', id]]);
    expect(f.calls[2].filters).toEqual([['organization_id', org], ['id', connectionId], ['environment', 'SIMULATION']]);
    expect(f.calls[2].columns).not.toMatch(/secret|certificate|kms/);
  });
  it('stops at failed authentication without reading business rows', async () => {
    const f = fixture(); session.mockRejectedValue(new Error('UNAUTHORIZED'));
    await expect(checkZatcaPhaseTwoPreparationAccess(target)).rejects.toThrow('UNAUTHORIZED');
    expect(f.from).not.toHaveBeenCalled();
  });
  it.each([null, { role: 'OWNER', status: 'INACTIVE' }, { role: 'MEMBER', status: 'ACTIVE' },
    { role: 'VIEWER', status: 'ACTIVE' }])('denies missing/inactive/non-admin membership even with forged user metadata', async data => {
    const f = fixture(); f.rows.organization_members.data = data;
    await expect(checkZatcaPhaseTwoPreparationAccess(target)).rejects.toThrow();
    expect(f.calls.map(c => c.table)).toEqual(['organization_members']);
  });
  it.each(['userId', 'connectionId', 'unitId', 'snapshot', 'certificate'])('rejects caller %s before authentication', async field => {
    fixture(); await expect(checkZatcaPhaseTwoPreparationAccess({ ...target, [field]: other })).rejects.toThrow();
    expect(session).not.toHaveBeenCalled();
  });
  it.each(['organization_id', 'id'])('rejects a returned source with wrong %s', async field => {
    const f = fixture(); f.change('vat_einvoices', { [field]: other });
    await expect(checkZatcaPhaseTwoPreparationAccess(target)).rejects.toThrow('EINVOICE_SOURCE_SCOPE_MISMATCH');
    expect(f.calls).toHaveLength(2);
  });
  it.each(['ISSUED', 'CLEARED', 'REPORTED', 'REJECTED', 'VOID'])('rejects a %s source before connection lookup', async status => {
    const f = fixture(); f.change('vat_einvoices', { status });
    await expect(checkZatcaPhaseTwoPreparationAccess(target)).rejects.toThrow(); expect(f.calls).toHaveLength(2);
  });
  it('rejects absent draft/connection and database errors without fallback or credential access', async () => {
    for (const table of ['vat_einvoices', 'vat_einvoice_connections']) {
      for (const error of [null, { message: 'db failure' }]) {
        const f = fixture(); f.rows[table] = { data: null, error };
        await expect(checkZatcaPhaseTwoPreparationAccess(target)).rejects.toThrow(error ? 'EINVOICE_ACCESS_CHECK_FAILED' : table === 'vat_einvoices' ? 'EINVOICE_DRAFT_NOT_FOUND' : 'EINVOICE_CONNECTION_NOT_FOUND');
      }
    }
  });
  it.each(['id', 'organization_id', 'environment'])('rejects wrong connection %s', async field => {
    const f = fixture(); f.change('vat_einvoice_connections', { [field]: field === 'environment' ? 'PRODUCTION' : other });
    await expect(checkZatcaPhaseTwoPreparationAccess(target)).rejects.toThrow('EINVOICE_CONNECTION_SCOPE_MISMATCH');
  });
  it.each(['NOT_CONFIGURED', 'KEY_READY', 'COMPLIANCE_PENDING', 'PRODUCTION_PENDING', 'ERROR', 'CONNECTED'])('refuses simulation connection status %s', async status => {
    const f = fixture(); f.change('vat_einvoice_connections', { status });
    await expect(checkZatcaPhaseTwoPreparationAccess(target)).rejects.toThrow('EINVOICE_CONNECTION_NOT_READY');
  });
  it('requires a connected production unit and matching VAT number/category', async () => {
    const f = fixture(); f.change('vat_einvoice_connections', { environment: 'PRODUCTION' });
    const prod = { ...target, environment: 'PRODUCTION' };
    await expect(checkZatcaPhaseTwoPreparationAccess(prod)).rejects.toThrow('EINVOICE_CONNECTION_NOT_READY');
    f.change('vat_einvoice_connections', { status: 'CONNECTED' });
    expect((await checkZatcaPhaseTwoPreparationAccess(prod)).scope.environment).toBe('PRODUCTION');
    f.change('vat_einvoice_connections', { taxpayer_vat_number: '399999999999993' });
    await expect(checkZatcaPhaseTwoPreparationAccess(prod)).rejects.toThrow('SELLER_VAT_MISMATCH');
  });
  it.each([['STANDARD', '0100'], ['SIMPLIFIED', '1000']])('rejects unsupported %s on %s unit', async (invoice_category, invoice_type) => {
    const f = fixture(); f.change('vat_einvoices', { invoice_category }); f.change('vat_einvoice_connections', { invoice_type });
    await expect(checkZatcaPhaseTwoPreparationAccess(target)).rejects.toThrow('EINVOICE_UNIT_CATEGORY_MISMATCH');
  });
  it('captures the target before awaiting the session', async () => {
    fixture(); const input = { ...target }; const pending = checkZatcaPhaseTwoPreparationAccess(input);
    input.organizationId = other; input.documentId = other; input.environment = 'PRODUCTION';
    expect((await pending).scope.organizationId).toBe(org);
  });
});
