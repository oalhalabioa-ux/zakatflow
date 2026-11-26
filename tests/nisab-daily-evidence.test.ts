import { expect, it } from 'vitest';
import { calculateAssessment } from '../engine/assessment';
import { projectPersonalHawlPolicy } from '../engine/personal-hawl-policy';
import type { Movement, Quote } from '../lib/first-nisab';
import { personalNisabDailyEvidence } from './fixtures/nisab-daily-evidence';

const start = '2025-01-01';
const oldDue = '2026-01-01';
const recovery = '2025-07-01';
const due = '2026-07-01';

function metal(id: string, date: string, units: string): Movement {
  return { id, date, asset: 'GOLD', units };
}

function assess(movements: Movement[], assessmentDate: string) {
  const closes = personalNisabDailyEvidence({ movements, quotes: [], standard: 'GOLD', from: start, through: assessmentDate });
  const policy = projectPersonalHawlPolicy({
    cycleStart: start, assessmentDate, calendar: 'GREGORIAN', nisabPolicy: 'CONTINUOUS',
    additionsPolicy: 'INDEPENDENT_AFTER_NISAB', closes,
    positions: [
      { lotId: 'holding', kind: 'OPENING_BALANCE', holdingSince: start },
      { lotId: 'addition', kind: 'EXTERNAL_ADDITION', holdingSince: recovery },
    ],
  });
  if (policy.status !== 'PROJECTED') throw new Error(JSON.stringify(policy));
  const { zakatDue } = calculateAssessment(policy.lots.map(lot => ({
    lotId: lot.lotId, hawlCompleted: lot.hawlCompleted,
    marketValueBase: (lot.lotId === 'holding' ? 70 : 25) * 400,
  })), 34_000, 0.025, 38_000);
  return { closes, policy, zakatDue: zakatDue.toNumber() };
}

it('keeps the original due date when the net close on the movement day is at or above Nisab', () => {
  const movements = [metal('initial', '2024-12-31', '90'), metal('exit', recovery, '-20'), metal('entry', recovery, '25')];
  const { closes, policy, zakatDue } = assess(movements, oldDue);
  expect(closes[0]).toMatchObject({ movementIds: ['initial'], value: '90', basis: 'STANDARD_METAL_WEIGHT' });
  expect(closes.find(close => close.date === recovery)).toMatchObject({
    value: '95', threshold: 85, movementIds: ['entry', 'exit'], quoteIds: [],
  });
  expect(policy).toMatchObject({ effectiveStart: start, dueDate: oldDue, canClose: true });
  expect(zakatDue).toBe(700);
});

it('keeps the cycle open at the previous due date after a proven cross-day break', () => {
  const movements = [metal('initial', start, '90'), metal('exit', '2025-04-01', '-20'), metal('entry', recovery, '25')];
  const original = assess(movements, oldDue);
  expect(original.closes.find(close => close.date === '2025-04-01')).toMatchObject({ value: '70', movementIds: ['exit'] });
  expect(original.policy).toMatchObject({ effectiveStart: recovery, dueDate: due, canClose: false });
  expect(original.zakatDue).toBe(0);
  const restarted = assess(movements, due);
  expect(restarted.policy).toMatchObject({ effectiveStart: recovery, dueDate: due, canClose: true });
  expect(restarted.zakatDue).toBe(950);
});

it('uses each date’s own price for a mixed portfolio, including days without movements', () => {
  const movements: Movement[] = [metal('gold', start, '70'), { id: 'cash', date: start, asset: 'CASH', units: '6000' }];
  const quotes: Quote[] = [
    { id: 'q1', date: start, asset: 'GOLD', price: '425', source: 'fixture' },
    { id: 'q2', date: '2025-01-02', asset: 'GOLD', price: '400', source: 'fixture' },
    { id: 'q4a', date: '2025-01-04', asset: 'GOLD', price: '400', source: 'fixture' },
    { id: 'q4b', date: '2025-01-04', asset: 'GOLD', price: '401', source: 'fixture' },
  ];
  const closes = personalNisabDailyEvidence({ movements, quotes, standard: 'GOLD', from: start, through: '2025-01-04' });
  expect(closes).toMatchObject([
    { value: '35750', threshold: '36125', quoteIds: ['q1'] },
    { value: '34000', threshold: '34000', quoteIds: ['q2'], movementIds: [] },
    { needsReview: true, reviewReason: 'DATED_PRICE_REQUIRED' },
    { needsReview: true, reviewReason: 'DATED_PRICE_CONFLICT', quoteIds: ['q4a', 'q4b'] },
  ]);
});

it('detects a negative daily close and rejects duplicated movement evidence', () => {
  const input = { movements: [metal('exit', start, '-3')], quotes: [], standard: 'GOLD' as const, from: start, through: start };
  expect(personalNisabDailyEvidence(input)).toMatchObject([{ needsReview: true, reviewReason: 'NEGATIVE_BALANCE' }]);
  expect(() => personalNisabDailyEvidence({ ...input, movements: [...input.movements, ...input.movements] }))
    .toThrow('INVALID_NISAB_MOVEMENT_SOURCE');
});
