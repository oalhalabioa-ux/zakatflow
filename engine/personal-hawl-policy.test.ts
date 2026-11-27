import { describe, expect, it } from 'vitest';
import { calculateAssessment } from './assessment';
import { projectPersonalHawlPolicy, type DailyNisabEvidence } from './personal-hawl-policy';

const cycleStart = '2025-01-01';
const anniversary = '2026-01-01';
const dipDate = '2025-04-01';
const additionDate = '2025-07-01';
const threshold = 34_000;

function evidence(dipped: boolean, through = anniversary): DailyNisabEvidence[] {
  const closes: DailyNisabEvidence[] = [];
  for (const day = new Date(cycleStart + 'T00:00:00Z');;) {
    const date = day.toISOString().slice(0, 10);
    if (date > through) return closes;
    const oldGold = dipped && date >= dipDate ? 70 : 90;
    const addedGold = date >= additionDate ? 25 : 0;
    closes.push({ date, value: (oldGold + addedGold) * 400, threshold });
    day.setUTCDate(day.getUTCDate() + 1);
  }
}

const base = {
  cycleStart,
  assessmentDate: anniversary,
  calendar: 'GREGORIAN',
  nisabPolicy: 'CONTINUOUS',
  additionsPolicy: 'INDEPENDENT_AFTER_NISAB',
  positions: [
    { lotId: 'old', kind: 'OPENING_BALANCE', holdingSince: cycleStart },
    { lotId: 'additional', kind: 'EXTERNAL_ADDITION', holdingSince: additionDate },
  ],
} as const;

describe('personal Hawl policy projection for #463', () => {
  it.each([
    [true, 'CONTINUOUS', 'INDEPENDENT_AFTER_NISAB', 0],
    [true, 'CONTINUOUS', 'JOIN_EXISTING_POOL', 0],
    [true, 'START_END', 'INDEPENDENT_AFTER_NISAB', 700],
    [true, 'START_END', 'JOIN_EXISTING_POOL', 950],
    [false, 'CONTINUOUS', 'INDEPENDENT_AFTER_NISAB', 900],
    [false, 'CONTINUOUS', 'JOIN_EXISTING_POOL', 1150],
    [false, 'START_END', 'INDEPENDENT_AFTER_NISAB', 900],
    [false, 'START_END', 'JOIN_EXISTING_POOL', 1150],
  ] as const)('projects case dip=%s, rule=%s, additions=%s at the original cutoff', (dipped, nisabPolicy, additionsPolicy, expected) => {
    const result = projectPersonalHawlPolicy({ ...base, nisabPolicy, additionsPolicy, closes: evidence(dipped) });
    expect(result.status).toBe('PROJECTED');
    if (result.status !== 'PROJECTED') throw new Error('Expected Hawl projection');
    const oldValue = (dipped ? 70 : 90) * 400;
    const additionValue = 25 * 400;
    const assessment = calculateAssessment(result.lots.map(lot => ({
      lotId: lot.lotId,
      hawlCompleted: lot.hawlCompleted,
      marketValueBase: lot.lotId === 'old' ? oldValue : additionValue,
    })), threshold, '0.025', oldValue + additionValue);
    expect(assessment.zakatDue.toNumber()).toBe(expected);
    expect(result.canClose).toBe(!(dipped && nisabPolicy === 'CONTINUOUS'));
  });

  it('matures the restarted cycle on the reattainment anniversary', () => {
    const cutoff = '2026-07-01';
    expect(projectPersonalHawlPolicy({ ...base, assessmentDate: cutoff, closes: evidence(true, cutoff) })).toMatchObject({
      effectiveStart: additionDate, dueDate: cutoff, canClose: true,
      lots: [{ hawlStart: additionDate, hawlCompleted: true }, { hawlStart: additionDate, hawlCompleted: true }],
    });
  });

  it('requires missing closes for continuity but uses both endpoints for the endpoint rule', () => {
    const history = evidence(false).filter(({ date }) => date !== dipDate);
    expect(projectPersonalHawlPolicy({ ...base, closes: history })).toMatchObject({
      status: 'REVIEW', date: dipDate, reason: 'CLOSING_BALANCE_REQUIRED', canClose: false,
    });
    expect(projectPersonalHawlPolicy({
      ...base, nisabPolicy: 'START_END', closes: history.filter(({ date }) => date === cycleStart || date === anniversary),
    })).toMatchObject({ status: 'PROJECTED', canClose: true });
  });

  it('leaves days flagged by ambiguous evidence and conflicting closes for review', () => {
    const history = evidence(false);
    expect(projectPersonalHawlPolicy({
      ...base, closes: history.map(close => close.date === dipDate ? { date: dipDate, needsReview: true } : close),
    })).toMatchObject({ status: 'REVIEW', date: dipDate, reason: 'CLOSING_BALANCE_REQUIRES_REVIEW' });
    expect(projectPersonalHawlPolicy({ ...base, closes: [...history, { date: dipDate, value: 28_000, threshold }] }))
      .toMatchObject({ status: 'REVIEW', date: dipDate, reason: 'CLOSING_BALANCE_CONFLICT' });
  });

  it('keeps a below-Nisab cutoff open until there is qualifying evidence', () => {
    const cutoff = '2025-06-01';
    expect(projectPersonalHawlPolicy({ ...base, assessmentDate: cutoff, positions: [base.positions[0]], closes: evidence(true, cutoff) }))
      .toEqual({ status: 'BELOW_NISAB', date: cutoff, canClose: false });
  });

  it('requires review when the cutoff is beyond an already matured, unassessed period', () => {
    const cutoff = '2026-01-02';
    expect(projectPersonalHawlPolicy({ ...base, assessmentDate: cutoff, closes: evidence(false, cutoff) }))
      .toMatchObject({ status: 'REVIEW', date: anniversary, reason: 'OVERDUE_HAWL_REQUIRES_REVIEW', canClose: false });
  });

  it('treats a verified close exactly at Nisab as qualifying', () => {
    expect(projectPersonalHawlPolicy({
      ...base, closes: evidence(false).map(({ date }) => ({ date, value: threshold, threshold })),
    })).toMatchObject({ status: 'PROJECTED', effectiveStart: cycleStart, canClose: true });
  });
});
