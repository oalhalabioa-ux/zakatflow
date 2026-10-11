import {describe,it,expect} from 'vitest';
import {assetPageIndicators,indicatorPercent} from '../lib/asset-page-indicators';

describe('asset page indicators',()=>{
  const gold={id:'g',current_market_value:1200,current_cost_value:1000,is_zakatable:true,lifecycle_status:'ACTIVE',zakat_calculation:{zakat_amount:25,paid_amount:5,eligible_value:1000,statuses:['ELIGIBLE']},zakat_cycle_calculations:[{cycle_closed:true,lots:[{hawl_due_date:'2026-10-15'}]},{cycle_closed:false,lots:[{hawl_due_date:'2027-02-24'}]}]};
  const cash={id:'c',current_market_value:800,current_cost_value:800,is_zakatable:true,lifecycle_status:'ACTIVE',zakat_calculation:{zakat_amount:20,paid_amount:0,eligible_value:800,statuses:['ELIGIBLE']},lots:[{hawl_due_date:'2026-10-25'}]};
  const disposed={id:'d',current_market_value:900,current_cost_value:700,lifecycle_status:'DISPOSED',is_zakatable:true,zakat_calculation:{zakat_amount:10,paid_amount:10,statuses:['ELIGIBLE']}};
  it('sums the visible rows so type and category filters update the indicators',()=>{
    expect(assetPageIndicators([gold,cash],'2026-10-11')).toMatchObject({total:2000,cost:1800,totalDue:45,totalPaid:5,gain:200});
    expect(assetPageIndicators([gold],'2026-10-11')).toMatchObject({total:1200,cost:1000,totalDue:25,totalPaid:5,gain:200});
  });
  it('excludes exited balances but retains their unpaid historical liabilities in an all-assets report',()=>{
    const result=assetPageIndicators([gold,disposed],'2026-10-11');
    expect(result).toMatchObject({total:1200,cost:1000,totalDue:35,totalPaid:15});
    expect(result.active.map(r=>r.id)).toEqual(['g']);
  });
  it('uses new Hawl dates rather than closed-cycle dates for the next 30 days',()=>{
    expect(assetPageIndicators([gold,cash,disposed],'2026-10-11').near.map(r=>r.id)).toEqual(['c']);
  });
  it('uses authoritative current periods for new assets before their first assessment',()=>{
    const newAsset={...gold,zakat_calculation:null,zakat_cycle_calculations:[],lots:[{hawl_due_date:null,current_hawl_due_date:'2026-10-20'}]};
    expect(assetPageIndicators([newAsset],'2026-10-11').near).toHaveLength(1);
    expect(assetPageIndicators([{...gold,lots:[{current_hawl_due_date:'2027-02-24'}]}],'2026-10-11').near).toHaveLength(0);
  });
  it('handles empty scopes and ratios without fabricated progress',()=>{
    expect(assetPageIndicators([],'2026-10-11')).toMatchObject({total:0,cost:0,totalDue:0,totalPaid:0,near:[]});
    expect(indicatorPercent(5,25)).toBe(20);
    expect(indicatorPercent(-200,1000)).toBe(-20);
    expect(indicatorPercent(0,0)).toBe(0);
  });
});
