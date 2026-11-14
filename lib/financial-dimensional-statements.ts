import Decimal from 'decimal.js';
import {projectFinancialStatements, type StatementSource, type LedgerLine} from './financial-statement-engine';

const Money = Decimal.clone({precision: 50});
type Dimension = {branchId: string | null; centerId: string | null};
type Allocation = Dimension & {debit: string; credit: string};
export type DimensionEvidence = {
  organizationId: string;
  /** Revision of the complete dated registry, supplied by an authorized adapter. */
  revision: string;
  branches: readonly string[];
  centers: readonly {id: string; branchId: string | null}[];
  opening: readonly {accountId: string; allocations: readonly Allocation[]}[];
  movements: readonly {journalId: string; lineIndex: number; allocations: readonly Allocation[]}[];
};
const key = (d: Dimension) => JSON.stringify([d.branchId, d.centerId]);
function amount(s: string) {
  if (typeof s !== 'string' || !/^\d{1,20}(\.\d{1,4})?$/.test(s)) throw Error('DIMENSION_AMOUNT_INVALID');
  return new Money(s);
}
/** Pure projection only, not a database authority or approval mechanism.
 * Requires a complete, historical allocation of BOTH legs and every opening
 * account. Never creates a balancing account or allocates company totals by
 * percentages. The server must independently authorize and freeze this evidence.
 */
export function projectDimensionalStatements(source: StatementSource, evidence: DimensionEvidence) {
  const company = projectFinancialStatements(source);
  if (evidence.organizationId !== source.organizationId || !evidence.revision?.trim()) throw Error('DIMENSION_SCOPE_INVALID');
  const branches = new Set(evidence.branches), centers = new Map(evidence.centers.map(c => [c.id, c]));
  if (branches.size !== evidence.branches.length || [...branches].some(id => !id) || centers.size !== evidence.centers.length ||
      evidence.centers.some(c => !c.id || (c.branchId !== null && !branches.has(c.branchId)))) throw Error('DIMENSION_REGISTRY_INVALID');
  const buckets = new Map<string, {dimension: Dimension; opening: Map<string, {debit: Decimal; credit: Decimal}>; journals: Map<string, LedgerLine[]>}>();
  function allocate(line: {accountId: string; debit: string; credit: string}, parts: readonly Allocation[], write: (target: ReturnType<typeof bucket>, part: Allocation) => void) {
    if (!parts.length) throw Error('DIMENSION_ALLOCATION_MISSING');
    let debit = new Money(0), credit = new Money(0);
    const seen = new Set<string>();
    for (const p of parts) {
      if ((p.branchId !== null && !branches.has(p.branchId)) ||
          (p.centerId !== null && (!centers.has(p.centerId) || centers.get(p.centerId)!.branchId !== p.branchId))) throw Error('DIMENSION_BRANCH_CENTER_MISMATCH');
      const id = key(p);
      if (seen.has(id)) throw Error('DIMENSION_ALLOCATION_DUPLICATE');
      seen.add(id);
      const d = amount(p.debit), c = amount(p.credit);
      if (d.gt(0) && c.gt(0)) throw Error('DIMENSION_AMOUNT_INVALID');
      debit = debit.plus(d); credit = credit.plus(c);
      write(bucket(p), p);
    }
    if (!debit.eq(line.debit) || !credit.eq(line.credit)) throw Error('DIMENSION_ALLOCATION_UNRECONCILED');
  }
  function bucket(d: Dimension) {
    const id = key(d);
    let b = buckets.get(id);
    if (!b) { b = {dimension: {branchId: d.branchId, centerId: d.centerId}, opening: new Map(), journals: new Map()}; buckets.set(id, b); }
    return b;
  }
  const opening = new Map(evidence.opening.map(a => [a.accountId, a]));
  if (opening.size !== evidence.opening.length || opening.size !== source.opening.length) throw Error('DIMENSION_OPENING_INCOMPLETE');
  for (const line of source.opening) {
    const a = opening.get(line.accountId);
    if (!a) throw Error('DIMENSION_OPENING_INCOMPLETE');
    allocate(line, a.allocations, (b, p) => b.opening.set(line.accountId, {debit: amount(p.debit), credit: amount(p.credit)}));
  }
  const movements = new Map(evidence.movements.map(a => [JSON.stringify([a.journalId, a.lineIndex]), a]));
  if (movements.size !== evidence.movements.length || evidence.movements.some(a => !Number.isInteger(a.lineIndex) || a.lineIndex < 0)) throw Error('DIMENSION_MOVEMENT_DUPLICATE');
  const journals = source.journals.filter(j => j.status === 'POSTED' && j.date <= source.to);
  let count = 0;
  for (const journal of journals) journal.lines.forEach((line, index) => {
    const a = movements.get(JSON.stringify([journal.id, index]));
    if (!a) throw Error('DIMENSION_MOVEMENT_INCOMPLETE');
    count++;
    allocate(line, a.allocations, (b, p) => {
      if (amount(p.debit).isZero() && amount(p.credit).isZero()) return;
      const lines = b.journals.get(journal.id) ?? [];
      lines.push({...line, debit: p.debit, credit: p.credit});
      b.journals.set(journal.id, lines);
    });
  });
  if (count !== movements.size) throw Error('DIMENSION_MOVEMENT_EXTRA');
  const rows = [...buckets.values()].map(b => {
    const slice: StatementSource = {...source,
      opening: [...b.opening].map(([accountId, n]) => ({accountId, debit: n.debit.toFixed(4), credit: n.credit.toFixed(4)})),
      journals: journals.filter(j => b.journals.has(j.id)).map(j => ({...j, lines: b.journals.get(j.id)!})),
    };
    // Per-dimension opening/journals/reversals and cash must independently
    // reconcile. Inter-dimension clearing must exist in the actual source.
    return {...b.dimension, statements: projectFinancialStatements(slice)};
  });
  for (const section of ['income', 'position', 'cash'] as const) {
    for (const [metric, expected] of Object.entries(company[section])) {
      const total = rows.reduce((n, r) => n.plus((r.statements[section] as Record<string, string>)[metric]), new Money(0));
      if (!total.eq(expected)) throw Error('DIMENSION_STATEMENTS_UNRECONCILED');
    }
  }
  return {status: 'DIMENSION_PROJECTION_ONLY' as const, revision: evidence.revision, company, rows};
}
