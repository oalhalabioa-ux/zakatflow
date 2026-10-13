import { describe, expect, it } from 'vitest';
import { buildLiquidityForecast, buildScenarioForecast, getOutstandingLiquidityCommitments, lowestForecastBalance, liquidityForecastScale } from './liquidity-forecast';
const flows=[
 {direction:'INFLOW' as const,due_date:'2026-10-02',status:'CONFIRMED' as const,base_amount:200},
 {direction:'OUTFLOW' as const,due_date:'2026-10-03',status:'EXPECTED' as const,base_amount:75},
 {direction:'OUTFLOW' as const,due_date:'2026-10-04',status:'ACTUAL' as const,base_amount:50},
 {direction:'OUTFLOW' as const,due_date:'2026-10-04',status:'CONFIRMED' as const,base_amount:500,transfer_id:'internal-1'},
 {direction:'INFLOW' as const,due_date:'2026-10-04',status:'CONFIRMED' as const,base_amount:500,transfer_id:'internal-1'},
 {direction:'OUTFLOW' as const,due_date:'2026-10-11',status:'CONFIRMED' as const,base_amount:40},
];
describe('liquidity forecast',()=>{
 it('starts with the available cash and carries each weekly net into the next week',()=>{const weeks=buildLiquidityForecast(100,flows,'2026-09-28');expect(weeks[0].balance).toBe(225);expect(weeks[1].balance).toBe(185);});
 it('applies collection delays and expense uplift only to the scenario',()=>{const weeks=buildScenarioForecast(100,flows,'2026-09-28',14,20);expect(weeks[0].balance).toBe(10);expect(weeks[1].balance).toBe(-38);expect(weeks[2].balance).toBe(162);});
 it('excludes both sides of internal account transfers from forecast totals and balances',()=>{const week=buildLiquidityForecast(100,flows,'2026-09-28',1)[0];expect(week.inflow).toBe(200);expect(week.outflow).toBe(75);expect(week.balance).toBe(225);const scenario=buildScenarioForecast(100,flows,'2026-09-28',0,0,1)[0];expect(scenario.inflow).toBe(200);expect(scenario.outflow).toBe(75);expect(scenario.balance).toBe(225);});
 it('lists every unpaid external outflow, including overdue items, and excludes receipts, actuals and transfers',()=>{const commitments=getOutstandingLiquidityCommitments(flows,'2026-10-05');expect(commitments.map(flow=>flow.due_date)).toEqual(['2026-10-03','2026-10-11']);});
 it('finds the lowest point including the starting balance',()=>{expect(lowestForecastBalance(90,[{balance:110},{balance:40}])).toBe(40);expect(lowestForecastBalance(90,[{balance:110}])).toBe(90);});
});

describe('forecast visual scale',()=>{
 it('distinguishes the screenshot balances even when both exceed opening cash',()=>{
  const scale=liquidityForecastScale([3130000,3216250,3216250]);
  expect(scale.bar(3130000).width).toBeCloseTo(97.3183,4);
  expect(scale.bar(3216250).width).toBe(100);
 });
 it('places negative and positive balances on opposite sides of zero',()=>{
  const scale=liquidityForecastScale([-100,0,300]);
  expect(scale.zero).toBe(25);
  expect(scale.bar(-100)).toEqual({left:0,width:25});
  expect(scale.bar(300)).toEqual({left:25,width:75});
  expect(scale.position(-100)).toBe(0);
  expect(scale.position(300)).toBe(100);
  expect(scale.bar(0).width).toBe(0);
 });
 it('keeps an all-zero forecast finite with empty bars',()=>{
  const scale=liquidityForecastScale([0,0]);
  expect(scale.bar(0)).toEqual({left:0,width:0});
  expect(scale.position(0)).toBe(0);
 });
});
