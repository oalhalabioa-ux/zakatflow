import type {OpeningDrafts, OpeningItem} from './financial-opening-preview';
import type {OpeningWorkspaceData} from './financial-opening-workspace';

export const EQUITY_EXTRA_PREFIX = 'equity-child:';

type Chart = OpeningWorkspaceData['chart'];

/** An extra equity line is a separate posting account, never a reassignment of an existing line. */
export function equityOpeningAccounts(chart: Chart, sourceRows: OpeningItem[], drafts: OpeningDrafts) {
 const assigned = new Set<string>();
 for (const row of sourceRows) {
  if (row.tab !== 'equity') continue;
  const chosen = drafts[row.id]?.accountCode;
  if (chosen && chosen.length > 4) assigned.add(chosen);
 }
 for (const id of Object.keys(drafts)) {
  if (id.startsWith(EQUITY_EXTRA_PREFIX)) assigned.add(id.slice(EQUITY_EXTRA_PREFIX.length));
 }
 return chart.filter(a => a.kind === 'EQUITY' && /^\d{6}(?:\d{2}){0,2}$/.test(a.code)
  && ['3100', '3200', '3300'].includes(a.reportingCode ?? '') && !assigned.has(a.code));
}

/** Extra lines appear only when the user explicitly adds them, including after a draft reload. */
export function openingEquityExtraRows(chart: Chart, drafts: OpeningDrafts): OpeningItem[] {
 const byCode = new Map(chart.map(a => [a.code, a]));
 return Object.keys(drafts).filter(id => id.startsWith(EQUITY_EXTRA_PREFIX)).flatMap(id => {
  const code = id.slice(EQUITY_EXTRA_PREFIX.length);
  const account = byCode.get(code);
  if (!account || account.kind !== 'EQUITY' || !['3100', '3200', '3300'].includes(account.reportingCode ?? '')) return [];
  return [{id, tab:'equity' as const, accountCode:code, accountAr:account.ar, accountEn:account.en,
   ar:account.ar, en:account.en, normal:'CREDIT' as const, vouchers:[]}];
 });
}
