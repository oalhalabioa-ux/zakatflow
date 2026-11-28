import { afterEach, describe, expect, it, vi } from 'vitest';
import { readPersonalProfessionalIncome } from '../services/personal-professional-income';

const { requireUser } = vi.hoisted(() => ({ requireUser: vi.fn() }));
vi.mock('../services/auth', () => ({ requireUser }));

const owner = '10000000-0000-4000-8000-000000000001';
const row = { id: '10000000-0000-4000-8000-000000000002', owner_id: owner,
  receivable_id: '10000000-0000-4000-8000-000000000003', document_date: '2026-03-31',
  kind: 'EXTERNAL_EVIDENCE', net_amount: '10000.00', tax_amount: '1500.00' };
const dates = ['2026-03-01', '2026-03-31'] as const;

function provide(rows: unknown[]) {
  const query = {
    select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), not: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(), gte: vi.fn().mockReturnThis(), lte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(), range: vi.fn().mockResolvedValue({ data: rows, error: null }),
  };
  const from = vi.fn().mockReturnValue(query);
  requireUser.mockResolvedValue({ user: { id: owner }, supabase: { from } });
  return { from, query };
}

afterEach(() => vi.resetAllMocks());

describe('professional income from the owner’s recognized documents', () => {
  it('reads the dated billing source without joining collections or attachments', async () => {
    const { from, query } = provide([row]);
    await expect(readPersonalProfessionalIncome(...dates)).resolves.toEqual([{
      documentId: row.id, receivableId: row.receivable_id, date: row.document_date,
      kind: row.kind, currency: 'SAR', net: '10000.00', tax: '1500.00',
    }]);
    expect(from).toHaveBeenCalledExactlyOnceWith('personal_income_documents');
    expect(query.eq).toHaveBeenCalledWith('owner_id', owner);
    expect(query.neq).toHaveBeenCalledWith('kind', 'TAX_DRAFT');
    expect(query.not).toHaveBeenCalledWith('receivable_id', 'is', null);
    expect(query.gte).toHaveBeenCalledWith('document_date', dates[0]);
    expect(query.lte).toHaveBeenCalledWith('document_date', dates[1]);
  });

  it.each([
    [row, row],
    [{ ...row, owner_id: '10000000-0000-4000-8000-000000000009' }],
    [{ ...row, document_date: '2026-04-01' }],
    [{ ...row, kind: 'TAX_DRAFT', receivable_id: null }],
  ])('withholds income when rows contradict source bounds (%j)', async (...incorrectRows) => {
    provide(incorrectRows);
    await expect(readPersonalProfessionalIncome(...dates)).rejects.toThrow(/PERSONAL_PROFESSIONAL_INCOME_SOURCE_/);
  });
});
