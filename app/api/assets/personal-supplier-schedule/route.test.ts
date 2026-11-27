import { beforeEach, expect, it, vi } from 'vitest';
import { GET, POST } from './route';

const { create, rpc, requireUser } = vi.hoisted(() => ({
  create: vi.fn(), rpc: vi.fn(), requireUser: vi.fn(),
}));
vi.mock('../../../../services/personal-asset-supplier', () => ({ createPersonalSupplierAsset: create }));
vi.mock('../../../../services/auth', () => ({ requireUser }));

const id = '123e4567-e89b-42d3-a456-426614174000';
const url = 'https://app.yaqeenbiz.com/api/assets/personal-supplier-schedule';
const asset = { name: 'Synthetic asset' };
const terms = { mode: 'DEFERRED', supplier_name: 'Supplier', entries: [
  { kind: 'INSTALLMENT', due_date: '2026-12-01', principal: '100000.00' },
] };
const request = (body: unknown, origin = 'https://app.yaqeenbiz.com') =>
  new Request(url, { method: 'POST', headers: { origin }, body: JSON.stringify(body) });

beforeEach(() => {
  vi.resetAllMocks();
  requireUser.mockResolvedValue({ supabase: { rpc } });
  create.mockResolvedValue({ id });
  rpc.mockResolvedValue({ data: id, error: null });
});

it('passes an exact supplier schedule and request ID to acquisition', async () => {
  const result = await POST(request({ asset, request_id: id, terms }));
  expect(result.status).toBe(201);
  expect(result.headers.get('cache-control')).toBe('private, no-store');
  expect(create).toHaveBeenCalledWith(asset, id, terms);
});

it('uses the owned procedure for cutoff and full asset reversal', async () => {
  const get = await GET(new Request(url + '?asset_id=' + id + '&as_of=2026-11-15'));
  expect(await get.json()).toEqual({ schedule: id });
  expect(rpc).toHaveBeenCalledWith('read_personal_supplier_schedule', { p_asset_id: id, p_as_of: '2026-11-15' });
  expect(await (await POST(request({ action: 'REVERSE', asset_id: id }))).json()).toEqual({ reversal_id: id });
  expect(rpc).toHaveBeenCalledWith('reverse_personal_supplier_asset', { p_asset_id: id });
});

it('rejects cross-origin commands and selectors with duplicate or malformed dates', async () => {
  expect((await POST(request({ asset, request_id: id, terms }, 'https://example.invalid'))).status).toBe(403);
  expect((await GET(new Request(url + '?asset_id=' + id + '&as_of=2026-02-30'))).status).toBe(400);
  expect((await GET(new Request(url + '?asset_id=' + id + '&as_of=2026-01-01&as_of=2026-02-01'))).status).toBe(400);
  expect(create).not.toHaveBeenCalled();
  expect(rpc).not.toHaveBeenCalled();
});

it('returns a conflict when the asset has active installments and keeps runtime errors private', async () => {
  const reverse = () => POST(request({ action: 'REVERSE', asset_id: id }));
  rpc.mockResolvedValueOnce({ error: { message: 'PERSONAL_SUPPLIER_REVERSE_INSTALLMENTS_FIRST' } })
    .mockResolvedValueOnce({ error: { message: 'internal table detail' } });
  expect((await reverse()).status).toBe(409);
  const failed = await reverse();
  expect(failed.status).toBe(500);
  expect(await failed.json()).toEqual({ error: 'PERSONAL_SUPPLIER_SCHEDULE_FAILED' });
});
