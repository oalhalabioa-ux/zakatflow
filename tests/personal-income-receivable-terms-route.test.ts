import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  auth: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock('../services/auth', () => ({ requireUser: db.auth }));
import { GET, POST } from '../app/api/personal-income/receivable-terms/route';

const url = 'http://localhost/api/personal-income/receivable-terms';
const documentId = '6329814b-a880-4e84-870c-2526482c3f48';
const requestId = 'fc229417-6cfd-48ed-9e2c-606b52ab45a5';
const payload = { documentId, requestId, dueDate: '2026-11-26', classification: 'GOOD', effectiveDate: '2026-11-27' };

function write(body: unknown = payload, origin = 'http://localhost') {
  return POST(new Request(url, { method: 'POST', headers: { origin }, body: JSON.stringify(body) }));
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('NEXT_PUBLIC_PERSONAL_INCOME', 'true');
  db.auth.mockResolvedValue({ user: { id: 'owner' }, supabase: db });
});
afterEach(() => vi.unstubAllEnvs());

describe('personal invoice receivable terms', () => {
  it('denies the disabled feature and cross-origin writes', async () => {
    expect((await write(payload, 'https://untrusted.example')).status).toBe(403);
    vi.stubEnv('NEXT_PUBLIC_PERSONAL_INCOME', 'false');
    expect((await write()).status).toBe(404);
    expect((await GET(new Request(url + '?document=' + documentId))).status).toBe(404);
    expect(db.auth).not.toHaveBeenCalled();
  });

  it('validates the input and writes only the dated event through the signed-in RPC', async () => {
    expect((await write({ ...payload, classification: 'UNKNOWN' })).status).toBe(400);
    expect((await write({ ...payload, owner_id: 'another-user' })).status).toBe(400);
    expect(db.rpc).not.toHaveBeenCalled();
    db.rpc.mockResolvedValue({ data: { id: 17 }, error: null });
    expect((await write()).status).toBe(200);
    expect((await write()).status).toBe(200);
    expect(db.rpc.mock.calls).toEqual(Array(2).fill(['record_personal_invoice_hawl_event', {
      p_document: documentId, p_request: requestId, p_due_date: '2026-11-26',
      p_classification: 'GOOD', p_effective_date: '2026-11-27',
    }]));
    expect(db.from).not.toHaveBeenCalled();
  });

  it('preserves the database guard errors', async () => {
    for (const [message, status] of [
      ['PERSONAL_INVOICE_HAWL_DOCUMENT_NOT_FOUND', 404],
      ['PERSONAL_INVOICE_HAWL_EVENT_INVALID', 400],
      ['PERSONAL_INVOICE_HAWL_REQUEST_CONFLICT', 409],
    ] as const) {
      db.rpc.mockResolvedValue({ data: null, error: { message } });
      expect((await write()).status).toBe(status);
    }
  });

  it('checks ownership and recognition before reading history and keeps the response private', async () => {
    const invoice = {
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    const row = { id: 17, classification: 'GOOD', due_date: '2026-11-26', effective_date: '2026-11-27' };
    const history = {
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
      order: vi.fn(),
    };
    history.order.mockReturnValueOnce(history).mockResolvedValueOnce({ data: [row], error: null });
    db.from.mockImplementation(table => table === 'personal_income_documents' ? invoice : history);
    const query = new Request(url + '?document=' + documentId);
    expect((await GET(query)).status).toBe(404);
    expect(history.select).not.toHaveBeenCalled();
    invoice.maybeSingle.mockResolvedValue({ data: { id: documentId }, error: null });
    const response = await GET(query);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await response.json()).toEqual({ events: [row] });
    expect(invoice.eq).toHaveBeenCalledWith('owner_id', 'owner');
    expect(invoice.not).toHaveBeenCalledWith('receivable_id', 'is', null);
    expect(history.eq).toHaveBeenCalledWith('document_id', documentId);
    expect(history.order.mock.calls).toEqual([['effective_date', { ascending: false }], ['id', { ascending: false }]]);
  });
});
