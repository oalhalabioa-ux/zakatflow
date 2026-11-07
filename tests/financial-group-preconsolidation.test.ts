import { describe, expect, it } from 'vitest';
import { preflightControlledGroup, type ControlledGroupSource } from '../lib/financial-group-preconsolidation';

const source: ControlledGroupSource = {
  currency: 'SAR',
  parents: [{code:'1000',kind:'ASSET'}, {code:'3000',kind:'EQUITY'}],
  control: {
    rootOrganizationId: 'P', from: '2026-01-01', to: '2026-12-31',
    expectedOrganizationIds: ['P','A'], authorizedOrganizationIds: ['A','P'],
    registry: {complete:true,revision:'approved-complete-1',relationshipCount:1},
    relationships: [{parentOrganizationId:'P',subsidiaryOrganizationId:'A',effectiveFrom:'2025-01-01',effectiveTo:null,
      directEconomicInterestPercent:'80',directVotingInterestPercent:'65',controlBasis:'VOTING',
      controlAssessmentId:'control-A',assessmentStatus:'APPROVED'}],
  },
  members: [
    {organizationId:'P',from:'2026-01-01',to:'2026-12-31',currency:'SAR',details:[
      {accountId:'p-asset',code:'100001',reportingCode:'1000',kind:'ASSET',debit:'100',credit:'0'},
      {accountId:'p-equity',code:'300001',reportingCode:'3000',kind:'EQUITY',debit:'0',credit:'100'},
    ]},
    {organizationId:'A',from:'2026-01-01',to:'2026-12-31',currency:'SAR',details:[
      {accountId:'a-asset',code:'100001',reportingCode:'1000',kind:'ASSET',debit:'200',credit:'0'},
      {accountId:'a-equity',code:'300001',reportingCode:'3000',kind:'EQUITY',debit:'0',credit:'200'},
    ]},
  ],
};

describe('control-aware pre-elimination aggregation', () => {
  it('sums 100% of controlled subsidiary assets, never just its 80% ownership share', () => {
    const result = preflightControlledGroup(source);
    expect(result.status).toBe('CONTROLLED_PRE_ELIMINATION_ONLY');
    expect(result.wholeEntityRollup.totalDebit).toBe('300.0000');
    expect(result.wholeEntityRollup.byParent.find(r=>r.code==='1000')?.members).toEqual([
      {organizationId:'A',debit:'200.0000',credit:'0.0000',netDebit:'200.0000'},
      {organizationId:'P',debit:'100.0000',credit:'0.0000',netDebit:'100.0000'},
    ]);
    expect(result.control.members.find(r=>r.organizationId==='A')?.effectiveEconomicInterestPercent).toBe('80.000000');
  });

  it('blocks a missing authorized subsidiary source instead of returning a parent-only total', () => {
    expect(()=>preflightControlledGroup({...source,members:source.members.slice(0,1)}))
      .toThrow('REPORTING_ROLLUP_MEMBERSHIP_INVALID');
  });

  it('blocks a midyear control change before source aggregation', () => {
    const control={...source.control,relationships:[{...source.control.relationships[0],effectiveFrom:'2026-05-01'}]};
    expect(()=>preflightControlledGroup({...source,control})).toThrow('GROUP_CONTROL_PERIOD_NOT_FULLY_COVERED');
  });

  it('blocks subsidiary trial balances in a different currency even when group control is verified', () => {
    const members=[source.members[0],{...source.members[1],currency:'USD'}];
    expect(()=>preflightControlledGroup({...source,members})).toThrow('REPORTING_ROLLUP_CURRENCY_MISMATCH');
  });
  it('includes a newly formed authorized subsidiary with no opening and no movements as a zero member', () => {
    const members=[source.members[0],{...source.members[1],details:[]}];
    const result=preflightControlledGroup({...source,members});
    expect(result.status).toBe('CONTROLLED_PRE_ELIMINATION_ONLY');
    expect(result.wholeEntityRollup.memberIds).toEqual(['A','P']);
    expect(result.wholeEntityRollup.totalDebit).toBe('100.0000');
    expect(result.wholeEntityRollup.byParent.find(r=>r.code==='1000')?.members)
      .toContainEqual({organizationId:'A',debit:'0.0000',credit:'0.0000',netDebit:'0.0000'});
  });

  it('includes a zero-opening subsidiary with balanced first-year movements without synthetic opening entries', () => {
    const members=[source.members[0],{...source.members[1],details:[
      {accountId:'new-cash',code:'100001',reportingCode:'1000',kind:'ASSET' as const,debit:'50',credit:'0'},
      {accountId:'new-equity',code:'300001',reportingCode:'3000',kind:'EQUITY' as const,debit:'0',credit:'50'},
    ]}];
    const result=preflightControlledGroup({...source,members});
    expect(result.wholeEntityRollup.totalDebit).toBe('150.0000');
    expect(result.wholeEntityRollup.byParent.find(r=>r.code==='1000')?.members)
      .toContainEqual({organizationId:'A',debit:'50.0000',credit:'0.0000',netDebit:'50.0000'});
  });

});
