import {describe,expect,it} from 'vitest';
import Decimal from 'decimal.js';
import {calculateAssessment} from './assessment';

describe('calculateAssessment',()=>{
  it('excludes the institution-covered period without reducing other assets or recording cash',()=>{
    const result=calculateAssessment([
      {lotId:'returned-capital',marketValueBase:100000,hawlCompleted:true,externalCoveredDays:90,hawlPeriodDays:354},
      {lotId:'other-cash',marketValueBase:100000,hawlCompleted:true},
    ],1,'0.025',200000);
    expect(result.lines[0].zakatAmount.toNumber()).toBeCloseTo(2500*(354-90)/354,10);
    expect(result.lines[1].zakatAmount.toNumber()).toBe(2500);
  });
  it('respects a 355-day Hijri year and excludes a fully covered year',()=>{
    const partial=calculateAssessment([{lotId:'a',marketValueBase:100000,hawlCompleted:true,externalCoveredDays:90,hawlPeriodDays:355}],1,'0.025',100000);
    expect(partial.zakatDue.toNumber()).toBeCloseTo(2500*265/355,10);
    const full=calculateAssessment([{lotId:'a',marketValueBase:100000,hawlCompleted:true,externalCoveredDays:355,hawlPeriodDays:355}],1,'0.025',100000);
    expect(full.zakatDue.toNumber()).toBe(0);
  });
  it('rejects coverage exceeding the Hawl period',()=>{
    expect(()=>calculateAssessment([{lotId:'a',marketValueBase:100000,hawlCompleted:true,externalCoveredDays:356,hawlPeriodDays:355}],1)).toThrow('INVALID_EXTERNAL_ZAKAT_COVERAGE');
  });
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
