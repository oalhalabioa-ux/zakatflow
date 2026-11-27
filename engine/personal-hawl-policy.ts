import Decimal from 'decimal.js';
import { calculateHawl, type HawlCalendar } from './hawl';

export type DailyNisabEvidence =
  | { date: string; value: Decimal.Value; threshold: Decimal.Value }
  | { date: string; needsReview: true };

export type PersonalHawlPosition = {
  lotId: string;
  kind: 'OPENING_BALANCE' | 'EXTERNAL_ADDITION';
  holdingSince: string;
};

type PersonalHawlPolicyInput = {
  cycleStart: string;
  assessmentDate: string;
  calendar: HawlCalendar;
  nisabPolicy: 'CONTINUOUS' | 'START_END';
  additionsPolicy: 'INDEPENDENT_AFTER_NISAB' | 'JOIN_EXISTING_POOL';
  closes: readonly DailyNisabEvidence[];
  positions: readonly PersonalHawlPosition[];
};

type ReviewReason =
  | 'CLOSING_BALANCE_REQUIRED'
  | 'CLOSING_BALANCE_CONFLICT'
  | 'CLOSING_BALANCE_REQUIRES_REVIEW'
  | 'START_BELOW_NISAB'
  | 'OVERDUE_HAWL_REQUIRES_REVIEW';

function dateAtUtc(day: string) {
  const date = new Date(day + 'T00:00:00Z');
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== day) {
    throw new Error('INVALID_HAWL_POLICY_DATE');
  }
  return date;
}

function review(date: string, reason: ReviewReason) {
  return { status: 'REVIEW', date, reason, canClose: false } as const;
}

/**
 * An assessment projection for ordinary personal holdings using verified daily closes.
 * The caller must classify external additions separately from internal transfers and
 * distinguish lots with inherited or separately covered periods before using this projection.
 */
export function projectPersonalHawlPolicy(input: PersonalHawlPolicyInput) {
  const { cycleStart, assessmentDate, calendar, nisabPolicy, additionsPolicy, closes, positions } = input;
  const start = dateAtUtc(cycleStart);
  const cutoff = dateAtUtc(assessmentDate);
  if (start > cutoff) throw new Error('ASSESSMENT_BEFORE_CYCLE_START');

  const indexed = new Map<string, DailyNisabEvidence>();
  for (const close of closes) {
    dateAtUtc(close.date);
    if (close.date < cycleStart || close.date > assessmentDate) continue;
    if (nisabPolicy === 'START_END' && close.date !== cycleStart && close.date !== assessmentDate) continue;
    if (indexed.has(close.date)) return review(close.date, 'CLOSING_BALANCE_CONFLICT');
    indexed.set(close.date, close);
  }

  function qualified(day: string) {
    const close = indexed.get(day);
    if (!close) return review(day, 'CLOSING_BALANCE_REQUIRED');
    if ('needsReview' in close) return review(day, 'CLOSING_BALANCE_REQUIRES_REVIEW');
    const value = new Decimal(close.value);
    const threshold = new Decimal(close.threshold);
    if (!value.isFinite() || !threshold.isFinite() || value.lt(0) || threshold.lte(0)) {
      return review(day, 'CLOSING_BALANCE_REQUIRES_REVIEW');
    }
    return { qualifies: value.gte(threshold) };
  }

  const origin = qualified(cycleStart);
  if ('status' in origin) return origin;
  if (!origin.qualifies) return review(cycleStart, 'START_BELOW_NISAB');

  const anniversary = (day: string) => calculateHawl(calendar, dateAtUtc(day), cutoff)
    .dueDate.toISOString().slice(0, 10);
  let effectiveStart: string | null = cycleStart;
  let dueDate = anniversary(cycleStart);

  if (nisabPolicy === 'START_END') {
    if (assessmentDate > dueDate) return review(dueDate, 'OVERDUE_HAWL_REQUIRES_REVIEW');
    const ending = qualified(assessmentDate);
    if ('status' in ending) return ending;
    if (!ending.qualifies) effectiveStart = null;
  } else {
    const day = new Date(start);
    while (day < cutoff) {
      day.setUTCDate(day.getUTCDate() + 1);
      const date = day.toISOString().slice(0, 10);
      if (effectiveStart && date > dueDate) return review(dueDate, 'OVERDUE_HAWL_REQUIRES_REVIEW');
      const closing = qualified(date);
      if ('status' in closing) return closing;
      if (!closing.qualifies) {
        effectiveStart = null;
      } else if (!effectiveStart) {
        effectiveStart = date;
        dueDate = anniversary(date);
      }
    }
  }

  if (!effectiveStart) return { status: 'BELOW_NISAB', date: assessmentDate, canClose: false } as const;

  const seen = new Set<string>();
  const lots = positions.map(({ lotId, kind, holdingSince }) => {
    if (!lotId || seen.has(lotId)) throw new Error('INVALID_HAWL_POSITION_ID');
    seen.add(lotId);
    dateAtUtc(holdingSince);
    if (holdingSince > assessmentDate ||
        (kind === 'OPENING_BALANCE' && holdingSince > cycleStart) ||
        (kind === 'EXTERNAL_ADDITION' && holdingSince <= cycleStart)) {
      throw new Error('INVALID_HAWL_POSITION_DATE');
    }
    const hawlStart = kind === 'EXTERNAL_ADDITION' && additionsPolicy === 'INDEPENDENT_AFTER_NISAB'
      && holdingSince > effectiveStart ? holdingSince : effectiveStart;
    const hawlDue = anniversary(hawlStart);
    return { lotId, hawlStart, hawlDue, hawlCompleted: hawlDue <= assessmentDate };
  });

  return { status: 'PROJECTED', effectiveStart, dueDate, canClose: assessmentDate === dueDate, lots } as const;
}
