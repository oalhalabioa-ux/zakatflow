import { describe, expect, it } from 'vitest';
import { samaFixedFxReference, samaReferenceToday } from './official-fx-reference';

const now = new Date('2026-11-25T21:30:00Z');

describe('Saudi Central Bank personal FX reference', () => {
  it('quotes the fixed parity in either direction on the requested date', () => {
    expect(samaFixedFxReference('USD', 'SAR', '2024-02-29', now)).toEqual({
      rate: 3.75, date: '2024-02-29',
    });
    expect(samaFixedFxReference('SAR', 'USD', '2024-02-29', now)?.rate).toBeCloseTo(4 / 15, 14);
  });

  it('uses Riyadh today and rejects future and non-calendar dates', () => {
    expect(samaReferenceToday(now)).toBe('2026-11-26');
    expect(samaFixedFxReference('USD', 'SAR', '2026-11-26', now)?.rate).toBe(3.75);
    for (const date of ['2026-11-27', '2025-02-29', '2025-2-1', '2025-01-01T00:00:00Z']) {
      expect(samaFixedFxReference('USD', 'SAR', date, now)).toBeNull();
    }
  });

  it('does not extrapolate beyond documented coverage or to other pairs', () => {
    expect(samaFixedFxReference('USD', 'SAR', '1987-01-01', now)?.rate).toBe(3.75);
    expect(samaFixedFxReference('USD', 'SAR', '1986-12-31', now)).toBeNull();
    expect(samaFixedFxReference('EUR', 'SAR', '2026-11-25', now)).toBeNull();
    expect(samaFixedFxReference('SAR', 'SAR', '2026-11-25', now)).toBeNull();
  });
});
