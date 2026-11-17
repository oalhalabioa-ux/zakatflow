export type ProposalState = 'pending' | 'approved' | 'rejected';
export type ProposalResolution = 'current' | 'proposed';

export function proposalStateLabel(state: ProposalState, ar: boolean) {
  if (state === 'approved') return ar ? 'مقبولة' : 'Approved';
  if (state === 'rejected') return ar ? 'مرفوضة' : 'Declined';
  return ar ? 'بانتظار المراجعة' : 'Awaiting review';
}

export function proposalReviewHref(locale: string, organization: string, project: string, proposal: string) {
  return '/' + locale + '/feasibility/shared/review?' + new URLSearchParams({ organization, project, proposal });
}
