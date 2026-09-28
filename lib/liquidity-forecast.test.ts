import { describe, expect, it } from 'vitest';
import { buildLiquidityForecast, buildScenarioForecast, lowestForecastBalance } from './liquidity-forecast';
const flows=[
 {direction:'INFLOW' as const,due_date:'2026-10-02',status:'CONFIRMED' as const,base_amount:200},
 {direction:'OUTFLOW' as const,due_date:'2026-10-03',status:'EXPECTED' as const,base_amount:75},
 {direction:'OUTFLOW' as const,due_date:'2026-10-04',status:'ACTUAL' as const,base_amount:50},
 {direction:'OUTFLOW' as const,due_date:'2026-10-11',status:'CONFIRMED' as const,base_amount:40},
];
describe('liquidity forecast',()=>{
 it('starts with the available cash and carries each weekly net into the next week',()=>{const weeks=buildLiquidityForecast(100,flows,'2026-09-28');expect(weeks[0].balance).toBe(225);expect(weeks[1].balance).toBe(185);});
 it('applies collection delays and expense uplift only to the scenario',()=>{const weeks=buildScenarioForecast(100,flows,'2026-09-28',14,20);expect(weeks[0].balance).toBe(10);expect(weeks[1].balance).toBe(-38);expect(weeks[2].balance).toBe(162);});
 it('finds the lowest point including the starting balance',()=>{expect(lowestForecastBalance(90,[{balance:110},{balance:40}])).toBe(40);expect(lowestForecastBalance(90,[{balance:110}])).toBe(90);});
});
