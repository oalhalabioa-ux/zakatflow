import { describe, expect, it } from 'vitest';

type Lot = { id: string; acquired: string; remainingQuantity: number; remainingValue: number };

function allocateFifo(lots: Lot[], requested: number) {
  let needed = requested;
  const allocations: Array<{ lotId: string; quantity: number; value: number }> = [];
  const next = lots
    .map((lot) => ({ ...lot }))
    .sort((a, b) => a.acquired.localeCompare(b.acquired) || a.id.localeCompare(b.id));

  if (next.reduce((sum, lot) => sum + lot.remainingQuantity, 0) < requested) {
    throw new Error('INSUFFICIENT_LOT_BALANCE');
  }

  for (const lot of next) {
    if (needed <= 0) break;
    const beforeQty = lot.remainingQuantity;
    const take = Math.min(needed, beforeQty);
    const value = beforeQty === 0 ? 0 : lot.remainingValue * take / beforeQty;
    lot.remainingQuantity -= take;
    lot.remainingValue = Math.max(0, lot.remainingValue - value);
    allocations.push({ lotId: lot.id, quantity: take, value });
    needed -= take;
  }
  return { lots: next, allocations };
}

function reverseAllocations(lots: Lot[], allocations: Array<{ lotId: string; quantity: number; value: number }>) {
  return lots.map((lot) => {
    const alloc = allocations.find((a) => a.lotId === lot.id);
    return alloc ? {
      ...lot,
      remainingQuantity: lot.remainingQuantity + alloc.quantity,
      remainingValue: lot.remainingValue + alloc.value,
    } : lot;
  });
}

describe('FIFO transaction engine', () => {
  it('consumes the oldest lot first and then the next lot proportionally', () => {
    const original: Lot[] = [
      { id: 'lot-1', acquired: '2026-01-01', remainingQuantity: 100, remainingValue: 1000 },
      { id: 'lot-2', acquired: '2026-02-01', remainingQuantity: 200, remainingValue: 4000 },
    ];
    const result = allocateFifo(original, 150);
    expect(result.allocations).toEqual([
      { lotId: 'lot-1', quantity: 100, value: 1000 },
      { lotId: 'lot-2', quantity: 50, value: 1000 },
    ]);
    expect(result.lots).toEqual([
      { id: 'lot-1', acquired: '2026-01-01', remainingQuantity: 0, remainingValue: 0 },
      { id: 'lot-2', acquired: '2026-02-01', remainingQuantity: 150, remainingValue: 3000 },
    ]);
    expect(reverseAllocations(result.lots, result.allocations)).toEqual(original);
  });

  it('rejects an outflow larger than the available lot quantity', () => {
    expect(() => allocateFifo([
      { id: 'lot-1', acquired: '2026-01-01', remainingQuantity: 10, remainingValue: 100 },
    ], 11)).toThrow('INSUFFICIENT_LOT_BALANCE');
  });
});
