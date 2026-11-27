import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from '../app/api/financial-reporting/group-v2-revaluation/route';
import { listGroupV2Revaluations } from '../services/financial-group-v2-revaluation';

const { readControl, statementContext, statementSource, requireUser } = vi.hoisted(() => ({
  readControl: vi.fn(), statementContext: vi.fn(), statementSource: vi.fn(), requireUser: vi.fn(),
}));
vi.mock('../services/financial-group-registered-source', () => ({ liveRegisteredGroupControl: readControl }));
vi.mock('../services/financial-statement-live', () => ({ liveStatementContext: statementContext, liveStatementSource: statementSource }));
vi.mock('../services/auth', () => ({ requireUser }));

const root = '10000000-0000-4000-8000-000000000001';
const subsidiary = '10000000-0000-4000-8000-000000000002';
const outside = '10000000-0000-4000-8000-000000000003';
const firstJournal = '10000000-0000-4000-8000-000000000004';
const secondJournal = '10000000-0000-4000-8000-000000000005';
const query = { organization: root, from: '2026-01-01', to: '2026-03-31' };
const control = { expectedOrganizationIds: [root, subsidiary], registry: { revision: 'old' } };

function evidence(organizationId: string, journalId: string) {
  return { organization_id: organizationId, journal_id: journalId, cutoff: '2026-03-31' };
}

function mockRecords(rows: ReturnType<typeof evidence>[]) {
  const select = {
    select: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(), gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue({ data: rows, error: null }),
  };
  requireUser.mockResolvedValue({ supabase: { from: vi.fn().mockReturnValue(select) } });
  readControl.mockResolvedValue(control);
  statementContext.mockResolvedValue([{ organizationId: root, name: 'Parent' }, { organizationId: subsidiary, name: 'Subsidiary' }]);
  return select;
}

afterEach(() => vi.resetAllMocks());

describe('registered-group revaluation picker', () => {
  it('lists only period evidence for the authorized registry and omits ambiguous journals', async () => {
    const select = mockRecords([evidence(subsidiary, firstJournal), evidence(root, secondJournal), evidence(root, secondJournal)]);
    await expect(listGroupV2Revaluations(query)).resolves.toEqual({
      status: 'V2_GROUP_REVALUATION_LIST', query, ambiguousJournals: 1,
      choices: [{ organization: subsidiary, name: 'Subsidiary', journal: firstJournal, cutoff: '2026-03-31' }],
    });
    expect(select.in).toHaveBeenCalledWith('organization_id', [root, subsidiary]);
    expect(select.gte).toHaveBeenCalledWith('cutoff', query.from);
    expect(select.lte).toHaveBeenCalledWith('cutoff', query.to);
  });

  it('rejects unexpected out-of-group evidence instead of leaking it', async () => {
    mockRecords([evidence(outside, firstJournal)]);
    await expect(listGroupV2Revaluations(query)).rejects.toThrow('REPORTING_ACCESS_DENIED');
  });

  it('reauthorizes the group after reading evidence', async () => {
    mockRecords([evidence(root, firstJournal)]);
    readControl.mockResolvedValueOnce(control).mockRejectedValueOnce(Error('REPORTING_ACCESS_DENIED'));
    await expect(listGroupV2Revaluations(query)).rejects.toThrow('REPORTING_ACCESS_DENIED');
  });

  it('reports ambiguous cutoff evidence without a review payload', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'REPORTING_FX_REVALUATION_AMBIGUOUS' } });
    requireUser.mockResolvedValue({ supabase: { rpc } });
    readControl.mockResolvedValue(control);
    const params = new URLSearchParams({ ...query, member: subsidiary, journal: firstJournal });
    const response = await GET(new Request('http://localhost/api/financial-reporting/group-v2-revaluation?' + params));
    expect(response.status).toBe(409);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await response.json()).toEqual({ error: 'REPORTING_FX_REVALUATION_AMBIGUOUS' });
    expect(rpc).toHaveBeenCalledWith('read_financial_fx_revaluation', {
      p_org: subsidiary, p_journal: firstJournal, p_as_of: query.to,
    });
  });
});
