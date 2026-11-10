import {
  validateGroupControlScope,
  type GroupControlPreflight,
  type VerifiedGroupControlScope,
} from './financial-group-control';
import {
  rollupAuthorizedTrialBalances,
  type AuthorizedTrialBalance,
  type ReportingParent,
  type PreEliminationRollup,
} from './financial-group-rollup';

export type ControlledGroupSource = {
  control: GroupControlPreflight;
  currency: string;
  parents: readonly ReportingParent[];
  /** Full trial balance of each legal entity, including all its internal branches. */
  members: readonly AuthorizedTrialBalance[];
};

export type ControlledPreElimination = {
  status: 'CONTROLLED_PRE_ELIMINATION_ONLY';
  control: VerifiedGroupControlScope;
  wholeEntityRollup: PreEliminationRollup;
};

/**
 * Combines two independently fail-closed QA primitives. A consolidated group
 * takes 100% of each controlled entity's verified source balances, NOT the
 * parent's economic ownership percentage. NCI is an accounting presentation
 * adjustment and is deliberately not derived here.
 *
 * Future server integration must first attest complete control membership,
 * authorize every entity, and verify revisions/currency/fiscal source coverage.
 * This function cannot convert client-provided attestations into authority.
 */
export function preflightControlledGroup(source: ControlledGroupSource): ControlledPreElimination {
  const control = validateGroupControlScope(source.control);
  const wholeEntityRollup = rollupAuthorizedTrialBalances({
    expectedOrganizationIds: control.members.map(member => member.organizationId),
    from: control.from,
    to: control.to,
    currency: source.currency,
    parents: source.parents,
    members: [...source.members],
  });
  return { status: 'CONTROLLED_PRE_ELIMINATION_ONLY', control, wholeEntityRollup };
}
