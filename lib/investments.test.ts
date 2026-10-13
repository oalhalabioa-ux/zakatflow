import {describe,it,expect} from 'vitest';
import {investmentProjection as project,investmentTermsSchema as schema,type InvestmentTerms} from './investments';
const terms:InvestmentTerms={name:'Test',instrument:'DEPOSIT',ownership_scope:'PERSONAL',organization_id:null,entity_id:null,cost_center_id:null,party_name:'Bank',currency:'SAR',principal:100000,face_value:100000,fees:0,annual_rate:6,start_date:'2027-01-01',maturity_date:'2027-04-01',interest_basis:'ACT_365',zakat_basis:'HIJRI_354',zakat_rate:2.5,zakat_base:100000,zakat_treatment:'INVESTOR',inflation_rate:3,fx_rate:1,funding_account_id:'10000000-0000-4000-8000-000000000001',reference:'',notes:'',zakat_assessment_mode:'INTERNAL',zakat_coverage_from:'',zakat_coverage_to:'',zakat_coverage_reference:''};
describe('investment estimates',()=>{
 it('requires a documented full-capital coverage period and defaults old contracts to internal assessment',()=>{
  expect(schema.parse(terms).zakat_assessment_mode).toBe('INTERNAL');
  const covered={...terms,zakat_treatment:'COVERED',zakat_assessment_mode:'INSTITUTION_COVERED',zakat_coverage_from:terms.start_date,zakat_coverage_to:terms.maturity_date,zakat_coverage_reference:'Bank contract'};
  expect(schema.safeParse(covered).success).toBe(true);
  expect(schema.safeParse({...covered,zakat_coverage_reference:''}).success).toBe(false);
  expect(schema.safeParse({...covered,zakat_coverage_to:'2027-04-02'}).success).toBe(false);
  expect(schema.safeParse({...covered,zakat_treatment:'DEDUCTED'}).success).toBe(false);
 });
 it('uses 90/354 for zakat, independently of the interest basis',()=>{
  const a=project(terms),b=project({...terms,interest_basis:'ACT_360'});
  expect(a.days).toBe(90);expect(a.zakat).toBe(635.5932);expect(b.zakat).toBe(a.zakat);
  expect(a.coupon).toBe(1479.4521);expect(b.coupon).toBe(1500);
 });
 it('keeps bank-covered zakat as a benefit, without adding cash',()=>{
  const p=project({...terms,zakat_treatment:'COVERED'});
  expect(p.net).toBe(p.coupon);expect(p.coveredBenefit).toBe(p.zakat);expect(p.maturityGross).toBe(100000+p.coupon);
 });
 it('compares inflation and net return over the same period',()=>{
  const p=project(terms),infl=Math.pow(1.03,90/365)-1;
  expect(p.realRate).toBeCloseTo(((1+p.net/p.cost)/(1+infl)-1)*100,10);
 });
 it('includes bond discount and fees without pretending to calculate YTM',()=>{
  const p=project({...terms,instrument:'BOND',principal:98000,face_value:100000,fees:200,annual_rate:5,maturity_date:'2028-01-01',zakat_rate:0});
  expect(p.coupon).toBe(5000);expect(p.gross).toBe(7000);expect(p.net).toBe(6800);expect(p.cost).toBe(98200);expect(p.maturityGross).toBe(105000);
 });
 it('splits intervals across actual tabular Hijri years',()=>{
  const p=project({...terms,start_date:'2025-01-01',maturity_date:'2028-01-01',zakat_basis:'HIJRI_TABULAR'});
  expect(p.zakatSegments.reduce((a,s)=>a+s.days,0)).toBe(1095);
  expect(new Set(p.zakatSegments.map(s=>s.yearDays))).toEqual(new Set([354,355]));
 });
 it('rejects invalid terms before estimation or saving',()=>{
  expect(schema.safeParse({...terms,maturity_date:terms.start_date}).success).toBe(false);
  expect(schema.safeParse({...terms,ownership_scope:'ORGANIZATION'}).success).toBe(false);
  expect(schema.safeParse({...terms,face_value:999}).success).toBe(false);
 });
});
