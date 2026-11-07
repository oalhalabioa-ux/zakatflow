import Decimal from 'decimal.js';

const Percent = Decimal.clone({ precision: 40 });
const decimalPercent = /^\d{1,3}(?:\.\d{1,6})?$/;

export type ControlledGroupRelationship = {
  parentOrganizationId: string;
  subsidiaryOrganizationId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  directEconomicInterestPercent: string;
  directVotingInterestPercent: string;
  controlBasis: 'VOTING' | 'CONTRACTUAL' | 'OTHER';
  controlAssessmentId: string;
  assessmentStatus: 'APPROVED' | 'DRAFT' | 'REVOKED';
};

export type GroupControlPreflight = {
  rootOrganizationId: string;
  from: string;
  to: string;
  /** All entities in the trusted full control registry, not a UI-picked subset. */
  expectedOrganizationIds: readonly string[];
  /** Every entity must be authorized independently by the server before this call. */
  authorizedOrganizationIds: readonly string[];
  registry: { complete: true; revision: string; relationshipCount: number };
  relationships: readonly ControlledGroupRelationship[];
};

export type VerifiedGroupControlScope = {
  status: 'CONTROL_SCOPE_PREFLIGHT_ONLY';
  rootOrganizationId: string;
  from: string;
  to: string;
  registryRevision: string;
  members: {
    organizationId: string;
    parentOrganizationId: string | null;
    directEconomicInterestPercent: string;
    /** Informational group economic interest, NOT an IFRS NCI journal. */
    effectiveEconomicInterestPercent: string;
    controlAssessmentId: string | null;
  }[];
};

function date(value: string) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

function percent(value: string) {
  if (typeof value !== 'string' || !decimalPercent.test(value)) throw Error('GROUP_CONTROL_PERCENT_INVALID');
  const amount = new Percent(value);
  if (amount.lt(0) || amount.gt(100)) throw Error('GROUP_CONTROL_PERCENT_INVALID');
  return amount;
}

/**
 * Pure, fail-closed evidence preflight. The server must supply an independently
 * authenticated, COMPLETE relationship registry and authorization for EVERY
 * member. The caller cannot derive that registry from visible parent pointers.
 *
 * This deliberately refuses mid-period acquisitions/disposals. Their P&L,
 * acquisition accounting and NCI need separate dated reporting adjustments.
 * A successful result is NOT a consolidation, a legal-control determination,
 * a substitute for source permissions, or an authorization token.
 */
export function validateGroupControlScope(input: GroupControlPreflight): VerifiedGroupControlScope {
  if (!date(input.from) || !date(input.to) || input.from > input.to) throw Error('GROUP_CONTROL_PERIOD_INVALID');
  if (!input.rootOrganizationId || input.registry?.complete !== true ||
    !input.registry.revision?.trim() || input.registry.relationshipCount !== input.relationships.length) {
    throw Error('GROUP_CONTROL_REGISTRY_INCOMPLETE');
  }
  const expected = new Set(input.expectedOrganizationIds);
  const authorized = new Set(input.authorizedOrganizationIds);
  if (!expected.has(input.rootOrganizationId) || !expected.size ||
    expected.size !== input.expectedOrganizationIds.length ||
    authorized.size !== input.authorizedOrganizationIds.length ||
    expected.size !== authorized.size || [...expected].some(id => !id || !authorized.has(id))) {
    throw Error('GROUP_CONTROL_MEMBERSHIP_UNAUTHORIZED');
  }
  if (input.relationships.length !== expected.size - 1) throw Error('GROUP_CONTROL_REGISTRY_INCOMPLETE');

  const bySubsidiary = new Map<string, ControlledGroupRelationship>();
  const assessmentIds = new Set<string>();
  const interests = new Map<string, Decimal>();
  for (const relationship of input.relationships) {
    const { parentOrganizationId: parent, subsidiaryOrganizationId: child } = relationship;
    if (!expected.has(parent) || !expected.has(child) || child === input.rootOrganizationId || parent === child ||
      bySubsidiary.has(child)) throw Error('GROUP_CONTROL_HIERARCHY_INVALID');
    if (relationship.assessmentStatus !== 'APPROVED' || !relationship.controlAssessmentId?.trim() ||
      assessmentIds.has(relationship.controlAssessmentId) ||
      !['VOTING', 'CONTRACTUAL', 'OTHER'].includes(relationship.controlBasis)) {
      throw Error('GROUP_CONTROL_EVIDENCE_UNAPPROVED');
    }
    if (!date(relationship.effectiveFrom) || (relationship.effectiveTo !== null && !date(relationship.effectiveTo)) ||
      relationship.effectiveFrom > input.from ||
      (relationship.effectiveTo !== null && relationship.effectiveTo < input.to)) {
      throw Error('GROUP_CONTROL_PERIOD_NOT_FULLY_COVERED');
    }
    const economic = percent(relationship.directEconomicInterestPercent);
    percent(relationship.directVotingInterestPercent);
    if (economic.isZero()) throw Error('GROUP_CONTROL_PERCENT_INVALID');
    bySubsidiary.set(child, relationship);
    assessmentIds.add(relationship.controlAssessmentId);
    interests.set(child, economic);
  }

  // Reachability and cycles are checked separately from the caller's membership
  // count: a complete-looking roster could still contain a disconnected cycle.
  const computing = new Set<string>();
  const calculated = new Map<string, Decimal>([[input.rootOrganizationId, new Percent(100)]]);
  const effectiveInterest = (id: string): Decimal => {
    const known = calculated.get(id);
    if (known) return known;
    if (computing.has(id)) throw Error('GROUP_CONTROL_HIERARCHY_INVALID');
    computing.add(id);
    const relation = bySubsidiary.get(id);
    if (!relation) throw Error('GROUP_CONTROL_HIERARCHY_INVALID');
    const ancestor = effectiveInterest(relation.parentOrganizationId);
    const result = ancestor.mul(interests.get(id)!).div(100);
    computing.delete(id);
    calculated.set(id, result);
    return result;
  };

  const members = [...expected].sort().map(organizationId => {
    const relation = bySubsidiary.get(organizationId);
    return {
      organizationId,
      parentOrganizationId: relation?.parentOrganizationId ?? null,
      directEconomicInterestPercent: relation ? interests.get(organizationId)!.toFixed(6) : '100.000000',
      effectiveEconomicInterestPercent: effectiveInterest(organizationId).toFixed(6),
      controlAssessmentId: relation?.controlAssessmentId ?? null,
    };
  });
  return {
    status: 'CONTROL_SCOPE_PREFLIGHT_ONLY', rootOrganizationId: input.rootOrganizationId,
    from: input.from, to: input.to, registryRevision: input.registry.revision, members,
  };
}
