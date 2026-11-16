import { describe, expect, it } from 'vitest';
import { validateGroupControlScope, type GroupControlPreflight } from '../lib/financial-group-control';

const base: GroupControlPreflight = {
  rootOrganizationId: 'P', from: '2026-01-01', to: '2026-12-31',
  expectedOrganizationIds: ['P', 'A', 'B'], authorizedOrganizationIds: ['B', 'P', 'A'],
  registry: { complete: true, revision: 'full-owner-signed-snapshot-1', relationshipCount: 2 },
  relationships: [
    { parentOrganizationId: 'P', subsidiaryOrganizationId: 'A', effectiveFrom: '2025-01-01', effectiveTo: null,
      directEconomicInterestPercent: '80', directVotingInterestPercent: '80', controlBasis: 'VOTING',
      assessmentStatus: 'APPROVED', controlAssessmentId: 'assessment-A' },
    { parentOrganizationId: 'A', subsidiaryOrganizationId: 'B', effectiveFrom: '2025-01-01', effectiveTo: null,
      directEconomicInterestPercent: '70', directVotingInterestPercent: '70', controlBasis: 'VOTING',
      assessmentStatus: 'APPROVED', controlAssessmentId: 'assessment-B' },
  ],
};

describe('effective-dated corporate control preflight', () => {
  it('uses full ledger membership for every controlled entity, not proportional source balances', () => {
    const result = validateGroupControlScope(base);
    expect(result.status).toBe('CONTROL_SCOPE_PREFLIGHT_ONLY');
    expect(result.members).toEqual([
      { organizationId: 'A', parentOrganizationId: 'P', directEconomicInterestPercent: '80.000000',
        effectiveEconomicInterestPercent: '80.000000', controlAssessmentId: 'assessment-A' },
      { organizationId: 'B', parentOrganizationId: 'A', directEconomicInterestPercent: '70.000000',
        effectiveEconomicInterestPercent: '56.000000', controlAssessmentId: 'assessment-B' },
      { organizationId: 'P', parentOrganizationId: null, directEconomicInterestPercent: '100.000000',
        effectiveEconomicInterestPercent: '100.000000', controlAssessmentId: null },
    ]);
  });

  it('supports a company with no controlled subsidiary', () => {
    const scope = validateGroupControlScope({ ...base, expectedOrganizationIds: ['P'],
      authorizedOrganizationIds: ['P'], registry: { complete: true, revision: 'all', relationshipCount: 0 }, relationships: [] });
    expect(scope.members).toHaveLength(1);
  });

  it('rejects an unauthorized or invisible controlled member even with balanced books', () => {
    expect(() => validateGroupControlScope({ ...base, authorizedOrganizationIds: ['P', 'A'] }))
      .toThrow('GROUP_CONTROL_MEMBERSHIP_UNAUTHORIZED');
  });

  it('rejects an incomplete or caller-filtered relationship registry', () => {
    expect(() => validateGroupControlScope({ ...base, relationships: base.relationships.slice(0, 1) }))
      .toThrow('GROUP_CONTROL_REGISTRY_INCOMPLETE');
  });

  it('rejects a midyear acquisition rather than counting the full-year P&L', () => {
    const relationships = [{ ...base.relationships[0], effectiveFrom: '2026-04-01' }, base.relationships[1]];
    expect(() => validateGroupControlScope({ ...base, relationships }))
      .toThrow('GROUP_CONTROL_PERIOD_NOT_FULLY_COVERED');
  });

  it('rejects a disposed subsidiary without annual comparability', () => {
    const relationships = [{ ...base.relationships[0], effectiveTo: '2026-06-30' }, base.relationships[1]];
    expect(() => validateGroupControlScope({ ...base, relationships }))
      .toThrow('GROUP_CONTROL_PERIOD_NOT_FULLY_COVERED');
  });

  it('requires an actual approved control assessment, not a hierarchy pointer or voting share alone', () => {
    const relationships = [{ ...base.relationships[0], assessmentStatus: 'DRAFT' as const }, base.relationships[1]];
    expect(() => validateGroupControlScope({ ...base, relationships }))
      .toThrow('GROUP_CONTROL_EVIDENCE_UNAPPROVED');
  });

  it('rejects duplicate parent claims on the same subsidiary', () => {
    const relationships = [base.relationships[0], { ...base.relationships[1], subsidiaryOrganizationId: 'A' }];
    expect(() => validateGroupControlScope({ ...base, relationships })).toThrow('GROUP_CONTROL_HIERARCHY_INVALID');
  });

  it('rejects a circular relationship disconnected from the parent', () => {
    const relationships = [{ ...base.relationships[0], parentOrganizationId: 'B' }, base.relationships[1]];
    expect(() => validateGroupControlScope({ ...base, relationships })).toThrow('GROUP_CONTROL_HIERARCHY_INVALID');
  });

  it('allows contractual control without pretending the voting majority decides consolidation', () => {
    const relationships = [{ ...base.relationships[0], directVotingInterestPercent: '35',
      controlBasis: 'CONTRACTUAL' as const }, base.relationships[1]];
    expect(validateGroupControlScope({ ...base, relationships }).members[0].directEconomicInterestPercent).toBe('80.000000');
  });

  it('does not silently round away sub-percentage ownership errors', () => {
    const relationships = [{ ...base.relationships[0], directEconomicInterestPercent: '100.000001' }, base.relationships[1]];
    expect(() => validateGroupControlScope({ ...base, relationships })).toThrow('GROUP_CONTROL_PERCENT_INVALID');
  });
});
