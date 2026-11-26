import Decimal from 'decimal.js';
import type { DailyNisabEvidence } from '../../engine/personal-hawl-policy';
import type { Movement, Quote, Standard } from '../../lib/first-nisab';

type DailyProof = DailyNisabEvidence & {
  movementIds: readonly string[];
  quoteIds: readonly string[];
  basis: 'STANDARD_METAL_WEIGHT' | 'DATED_MARKET_VALUE' | 'REVIEW';
  reviewReason?: 'NEGATIVE_BALANCE' | 'DATED_PRICE_REQUIRED' | 'DATED_PRICE_CONFLICT';
};

const standards = ['GOLD', 'SILVER'] as const;
const thresholds = { GOLD: 85, SILVER: 595 };

function calendarDay(value: string) {
  const date = new Date(value + 'T00:00:00Z');
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error('INVALID_NISAB_EVIDENCE_DATE');
  }
  return date;
}

/**
 * Projects closing evidence from a ledger already scoped and reconciled by the caller.
 * Units are pure grams or cash in the base currency. The opening day's movement IDs
 * also identify the older movements that built that day's balance.
 */
export function personalNisabDailyEvidence(input: {
  movements: readonly Movement[];
  quotes: readonly Quote[];
  standard: Standard;
  from: string;
  through: string;
}): DailyProof[] {
  const { standard, from, through } = input;
  const day = calendarDay(from);
  if (day > calendarDay(through)) throw new Error('INVALID_NISAB_EVIDENCE_RANGE');

  const movements = [...input.movements].sort(
    (left, right) => left.date.localeCompare(right.date) || left.id.localeCompare(right.id),
  );
  const seenMovements = new Set<string>();
  for (const movement of movements) {
    calendarDay(movement.date);
    if (!movement.id || seenMovements.has(movement.id)) throw new Error('INVALID_NISAB_MOVEMENT_SOURCE');
    if (!new Decimal(movement.units).isFinite()) throw new Error('INVALID_NISAB_MOVEMENT_QUANTITY');
    seenMovements.add(movement.id);
  }

  const quotes = new Map<string, Quote[]>();
  for (const quote of input.quotes) {
    calendarDay(quote.date);
    if (!quote.id || !quote.source.trim()) continue;
    const key = quote.date + quote.asset;
    const rows = quotes.get(key) ?? [];
    rows.push(quote);
    quotes.set(key, rows);
  }

  const balance = { CASH: new Decimal(0), GOLD: new Decimal(0), SILVER: new Decimal(0) };
  const other = standard === 'GOLD' ? 'SILVER' : 'GOLD';
  const results: DailyProof[] = [];
  let next = 0;

  while (true) {
    const date = day.toISOString().slice(0, 10);
    if (date > through) break;
    const movementIds: string[] = [];
    while (next < movements.length && movements[next].date <= date) {
      const movement = movements[next++];
      balance[movement.asset] = balance[movement.asset].plus(movement.units);
      movementIds.push(movement.id);
    }

    const quoteIds: string[] = [];
    const review = (reviewReason: NonNullable<DailyProof['reviewReason']>): DailyProof =>
      ({ date, needsReview: true, basis: 'REVIEW', movementIds, quoteIds, reviewReason });

    if (Object.values(balance).some(quantity => quantity.isNegative())) {
      results.push(review('NEGATIVE_BALANCE'));
    } else if (balance.CASH.isZero() && balance[other].isZero()) {
      // For a portfolio of just the standard metal, its price cancels out.
      results.push({
        date, value: balance[standard].toString(), threshold: thresholds[standard],
        basis: 'STANDARD_METAL_WEIGHT', movementIds, quoteIds,
      });
    } else {
      let value = balance.CASH;
      let threshold = new Decimal(0);
      let incomplete: DailyProof | undefined;

      for (const metal of standards) {
        if (metal !== standard && balance[metal].isZero()) continue;
        const matches = quotes.get(date + metal) ?? [];
        quoteIds.push(...matches.map(quote => quote.id).sort());
        const amounts = matches.map(quote => new Decimal(quote.price));
        const price = amounts[0];
        if (!price || amounts.some(amount => !amount.isFinite() || !amount.gt(0))) {
          incomplete = review('DATED_PRICE_REQUIRED');
          break;
        }
        if (amounts.some(amount => !amount.eq(price))) {
          incomplete = review('DATED_PRICE_CONFLICT');
          break;
        }
        value = value.plus(balance[metal].times(price));
        if (metal === standard) threshold = price.times(thresholds[metal]);
      }

      results.push(incomplete ?? {
        date, value: value.toString(), threshold: threshold.toString(),
        basis: 'DATED_MARKET_VALUE', movementIds, quoteIds,
      });
    }
    day.setUTCDate(day.getUTCDate() + 1);
  }
  return results;
}
