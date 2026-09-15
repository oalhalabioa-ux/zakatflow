import Decimal from 'decimal.js';
export function pureGoldGrams(grossGrams: Decimal.Value, karat: Decimal.Value): Decimal { const g=new Decimal(grossGrams), k=new Decimal(karat); if(g.isNegative()) throw new Error('grossGrams must be non-negative'); if(k.lte(0)||k.gt(24)) throw new Error('karat must be between 0 and 24'); return g.mul(k).div(24); }
