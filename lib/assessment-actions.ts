/** Hide unused previews while retaining the authoritative final and payment links. */
export function assessmentActions(a: any, cycle: any, linked: boolean) {
  const closed = !!cycle && (!['OPEN', 'ACTIVE'].includes(cycle.status) || !!cycle.final_assessment_id || cycle.final_zakat_due != null);
  const protectedStatus = ['CONFIRMED', 'PARTIALLY_PAID', 'PAID'].includes(a.status);
  const final = a.assessment_kind === 'FINAL' || cycle?.final_assessment_id === a.id;
  const missingCycle = !!a.hawl_cycle_id && !cycle;
  const lockedCurrent = closed && cycle.assessment_id === a.id;
  const reason = linked ? 'PAYMENT_OR_FINAL_CYCLE_LINK' : final || protectedStatus ? 'FINAL_ASSESSMENT' : missingCycle || lockedCurrent ? 'CLOSED_CYCLE_CURRENT' : null;
  return {
    can_delete: a.status !== 'CANCELLED' && !reason,
    can_edit: !!cycle && !closed && !final && !protectedStatus && a.status !== 'CANCELLED' && cycle.assessment_id === a.id && !a.superseded_by,
    linked, reason,
  };
}
