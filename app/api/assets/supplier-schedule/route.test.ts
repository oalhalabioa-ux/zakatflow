import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from './route';

const { createAsset, requireUser, rpc } = vi.hoisted(() => ({
  createAsset: vi.fn(), requireUser: vi.fn(), rpc: vi.fn(),
}));
vi.mock('../../../../services/assets', () => ({ createAsset }));
vi.mock('../../../../services/auth', () => ({ requireUser }));

const id = '123e4567-e89b-42d3-a456-426614174000';
const url = 'https://app.yaqeenbiz.com/api/assets/supplier-schedule';
const terms = { mode: 'DEFERRED', entries: [{ kind: 'INSTALLMENT', principal: '100000.00', due_date: '2026-12-01' }] };
const input = { request_id: id, asset: { name: 'Synthetic equipment' }, terms };
const post = (body: unknown, origin = 'https://app.yaqeenbiz.com') => POST(new Request(url, {
  method: 'POST', headers: { origin }, body: JSON.stringify(body),
}));

beforeEach(() => {
  vi.resetAllMocks();
  createAsset.mockResolvedValue({ id });
  rpc.mockResolvedValue({ data: { asset_id: id }, error: null });
  requireUser.mockResolvedValue({ supabase: { rpc } });
});

describe('asset supplier schedule API', () => {
  it('keeps the request ID and exact decimals for the atomic purchase', async () => {
    const result = await post(input);
    expect(result.status).toBe(201);
    expect(await result.json()).toEqual({ id });
    expect(createAsset).toHaveBeenCalledWith({ ...input.asset, request_id: id }, terms);
    expect(result.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('checks origin, dates and amounts before writing', async () => {
    expect((await post(input, 'https://example.invalid')).status).toBe(403);
    expect((await post({ ...input, terms: { ...terms, entries: [{ ...terms.entries[0], due_date: '2026-02-30' }] } })).status).toBe(400);
    expect((await post({ ...input, terms: { ...terms, entries: [{ ...terms.entries[0], principal: 0.01 }] } })).status).toBe(400);
    expect(createAsset).not.toHaveBeenCalled();
  });

  it('returns conflict on a changed retry and hides internal errors', async () => {
    createAsset.mockRejectedValueOnce({ message: 'ASSET_SUPPLIER_SCHEDULE_CONFLICT' })
      .mockRejectedValueOnce({ message: 'INTERNAL_DETAIL' });
    expect((await post(input)).status).toBe(409);
    const failed = await post(input);
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ error: 'ASSET_SUPPLIER_SCHEDULE_FAILED' });
  });

  it('uses the authorized reader and rejects additional or duplicated selectors', async () => {
    expect((await GET(new Request(url + '?asset_id=' + id + '&scope=PERSONAL'))).status).toBe(400);
    expect((await GET(new Request(url + '?asset_id=' + id + '&asset_id=' + id))).status).toBe(400);
    const result = await GET(new Request(url + '?asset_id=' + id));
    expect(await result.json()).toEqual({ schedule: { asset_id: id } });
    expect(rpc).toHaveBeenCalledWith('read_asset_supplier_schedule', { p_asset_id: id });
  });
});
