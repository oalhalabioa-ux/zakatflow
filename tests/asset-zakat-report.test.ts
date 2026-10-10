import {describe,it,expect} from 'vitest';
import {assetReportAssessments,assetReportCalculation} from '../lib/asset-zakat-report';

describe('asset cycle report',()=>{
  const cycles=[{id:'c1',status:'CLOSED',final_assessment_id:'f1',assessment_id:'old'}, {id:'c2',status:'ACTIVE',assessment_id:'o2'}];
  const assessments=[{id:'old',zakat_due:900},{id:'f1',status:'PARTIALLY_PAID',zakat_due:45000},{id:'o1',status:'CALCULATED',superseded_by:'o2',zakat_due:8000},{id:'o2',status:'CALCULATED',zakat_due:7000}];
  const calculations=[{assessment_id:'f1',cycle_closed:true,zakat_amount:45000,paid_amount:5000,remaining_amount:40000,lots:[{valuation_price:555}],statuses:['ELIGIBLE']}, {assessment_id:'o2',cycle_closed:false,zakat_amount:7000,paid_amount:0,remaining_amount:7000,lots:[{valuation_price:506}],statuses:['ELIGIBLE']}];
  it('includes the frozen final and latest referenced open snapshot once',()=>{
    expect(assetReportAssessments(cycles,assessments).map(x=>x.assessment.id)).toEqual(['f1','o2']);
  });
  it('does not include draft or superseded open estimates',()=>{
    expect(assetReportAssessments([{id:'c2',status:'OPEN',assessment_id:'o1'}],assessments)).toEqual([]);
    expect(assetReportAssessments([{id:'c2',status:'OPEN',assessment_id:'draft'}],[{id:'draft',status:'DRAFT'}])).toEqual([]);
  });
  it('adds liabilities and payments while preserving both saved prices',()=>{
    const result=assetReportCalculation(calculations,'ALL');
    expect(result).toMatchObject({zakat_amount:52000,paid_amount:5000,remaining_amount:47000});
    expect(result?.cycle_calculations.map((c:any)=>c.lots[0].valuation_price)).toEqual([555,506]);
  });
  it('closed and open views keep payments in their own cycle',()=>{
    expect(assetReportCalculation(calculations,'CLOSED')).toMatchObject({zakat_amount:45000,paid_amount:5000,remaining_amount:40000});
    expect(assetReportCalculation(calculations,'OPEN')).toMatchObject({zakat_amount:7000,paid_amount:0,remaining_amount:7000});
  });
  it('does not subtract excess payment from a new open cycle',()=>{
    const result=assetReportCalculation([{...calculations[0],paid_amount:46000,remaining_amount:0,credit_amount:1000},calculations[1]],'ALL');
    expect(result).toMatchObject({remaining_amount:7000,credit_amount:1000});
  });
  it('returns no assessment when an asset has no lines in the selected scope',()=>{
    expect(assetReportCalculation([],'OPEN')).toBeNull();
  });
});
