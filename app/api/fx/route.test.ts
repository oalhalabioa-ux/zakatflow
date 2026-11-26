import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from './route';

const { requireUser, requireAdmin } = vi.hoisted(() => ({
  requireUser: vi.fn(),
  requireAdmin: vi.fn(),
}));
vi.mock('../../../services/auth', () => ({ requireUser }));
vi.mock('../../../services/organization-access', () => ({ requireOrganizationAdmin: requireAdmin }));

const owner = '00000000-0000-4000-8000-000000000001';
const company = '00000000-0000-4000-8000-000000000002';
const url = 'http://localhost/api/fx';
const rate = {
  from_currency: 'USD', to_currency: 'SAR', rate: 3.75, valuation_date: '2026-11-07', source: 'Manual',
};

function request(payload: object) {
  return new Request(url, {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: { origin: 'http://localhost', 'content-type': 'application/json' },
  });
}

function query(result: unknown) {
  const q = {
    select: vi.fn(), in: vi.fn(), eq: vi.fn(), is: vi.fn(), or: vi.fn(),
    order: vi.fn(), limit: vi.fn(), upsert: vi.fn(), single: vi.fn(), insert: vi.fn(),
  };
  for (const method of [q.select, q.eq, q.is, q.or, q.order, q.upsert]) method.mockReturnValue(q);
  for (const method of [q.in, q.limit, q.single, q.insert]) method.mockResolvedValue(result);
  return q;
}

function setup() {
  const saved = { id: 'personal-rate', ...rate };
  const shared = { id: 'global-rate', ...rate };
  const tables = {
    personal_fx_rates: query({ data: [saved] }),
    fx_rates: query({ data: [shared] }),
    currencies: query({ data: [{ code: 'USD' }, { code: 'SAR' }] }),
    audit_logs: query({}),
  };
  tables.personal_fx_rates.single.mockResolvedValue({ data: saved });
  tables.fx_rates.single.mockResolvedValue({ data: { ...shared, organization_id: company } });
  const from = vi.fn((table: keyof typeof tables) => tables[table]);
  requireUser.mockResolvedValue({ supabase: { from }, user: { id: owner } });
  return tables;
}

beforeEach(() => vi.resetAllMocks());

describe('manual FX scope', () => {
  it('loads only the signed-in owner and global references in Personal', async () => {
    const tables = setup();
    const response = await GET(new Request(url + '?scope=PERSONAL'));
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await response.json()).toMatchObject([
      { id: 'personal-rate', scope: 'PERSONAL' }, { id: 'global-rate', scope: 'GLOBAL' },
    ]);
    expect(tables.personal_fx_rates.eq).toHaveBeenCalledWith('user_id', owner);
    expect(tables.fx_rates.is).toHaveBeenCalledWith('organization_id', null);
  });

  it('uses the authenticated owner and allows Personal without any institution', async () => {
    const tables = setup();
    const response = await POST(request({ ...rate, scope: 'PERSONAL' }));
    expect(response.status).toBe(201);
    expect(tables.personal_fx_rates.upsert).toHaveBeenCalledWith({ ...rate, user_id: owner }, {
      onConflict: 'user_id,from_currency,to_currency,valuation_date,source',
    });
    expect(tables.fx_rates.upsert).not.toHaveBeenCalled();
    expect(requireAdmin).not.toHaveBeenCalled();
  });

  it('keeps legacy company listings and writes within the institutional store', async () => {
    const tables = setup();
    expect((await GET(new Request(url + '?organization_id=' + company))).status).toBe(200);
    expect((await POST(request({ ...rate, organization_id: company }))).status).toBe(201);
    expect(tables.fx_rates.or).toHaveBeenCalledWith(`organization_id.eq.${company},organization_id.is.null`);
    expect(requireAdmin).toHaveBeenCalledWith(expect.anything(), owner, company);
    expect(tables.personal_fx_rates.select).not.toHaveBeenCalled();
    expect(tables.personal_fx_rates.upsert).not.toHaveBeenCalled();
  });

  it('rejects mixed scopes and client-supplied owners without persisting either', async () => {
    const tables = setup();
    expect((await GET(new Request(url + '?scope=PERSONAL&organization_id=' + company))).status).toBe(400);
    expect((await POST(request({ ...rate, scope: 'PERSONAL', organization_id: company }))).status).toBe(400);
    expect((await POST(request({ ...rate, scope: 'PERSONAL', user_id: company }))).status).toBe(400);
    expect(tables.personal_fx_rates.upsert).not.toHaveBeenCalled();
    expect(tables.fx_rates.upsert).not.toHaveBeenCalled();
  });
});
