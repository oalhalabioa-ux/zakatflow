import { describe, expect, it } from 'vitest';
import { getVatPeriod } from './vat-period';

describe('getVatPeriod', () => {
  it('returns a single monthly filing period', () => {
    expect(getVatPeriod('2026-09', 'MONTHLY')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
  });

  it('groups a selected month into the matching calendar quarter', () => {
    expect(getVatPeriod('2026-05', 'QUARTERLY')).toEqual({ from: '2026-04-01', to: '2026-06-30' });
  });

  it('supports fiscal quarters that cross a calendar year', () => {
    expect(getVatPeriod('2026-02', 'QUARTERLY', 4)).toEqual({ from: '2026-01-01', to: '2026-03-31' });
  });
});
