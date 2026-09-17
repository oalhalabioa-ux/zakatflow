import {describe,expect,it} from 'vitest';
import Decimal from 'decimal.js';
import {calculateAssessment} from './assessment';

describe('calculateAssessment',()=>{
  it('calculates 2.5% only on Hawl-completed wealth when eligible total reaches Nisab',()=>{
    const result=calculateAssessment([
      {lotId:'eligible',marketValueBase:100000,hawlCompleted:true},
      {lotId:'pending',marketValueBase:50000,hawlCompleted:false},
    ],85000,new Decimal('0.025'));
    expect(result.totalEligibleValue.toNumber()).toBe(100000);
    expect(result.zakatDue.toNumber()).toBe(2500);
    expect(result.lines[0].status).toBe('ELIGIBLE');
    expect(result.lines[0].zakatAmount.toNumber()).toBe(2500);
    expect(result.lines[1].status).toBe('HAWL_NOT_COMPLETED');
    expect(result.lines[1].zakatAmount.toNumber()).toBe(0);
  });

  it('returns no Zakat when Hawl-completed wealth is below Nisab',()=>{
    const result=calculateAssessment([
      {lotId:'small',marketValueBase:50000,hawlCompleted:true},
    ],85000);
    expect(result.totalEligibleValue.toNumber()).toBe(0);
    expect(result.zakatDue.toNumber()).toBe(0);
    expect(result.lines[0].status).toBe('BELOW_NISAB');
    expect(result.lines[0].zakatAmount.toNumber()).toBe(0);
  });

  it('supports a configured Zakat rate',()=>{
    const result=calculateAssessment([
      {lotId:'eligible',marketValueBase:100000,hawlCompleted:true},
    ],85000,new Decimal('0.03'));
    expect(result.zakatDue.toNumber()).toBe(3000);
  });
});
