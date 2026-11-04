import {describe,it,expect} from 'vitest';
import {accountingPresentationTree,chartIntegrationMessage} from '../lib/financial-chart-hierarchy';
const roots=[
 {code:'1000',parentCode:null,kind:'ASSET',presentation:'CURRENT'},
 {code:'1100',parentCode:null,kind:'ASSET',presentation:'CURRENT'},
 {code:'1500',parentCode:null,kind:'ASSET',presentation:'NON_CURRENT'},
 {code:'2100',parentCode:null,kind:'LIABILITY',presentation:'CURRENT'},
 {code:'2200',parentCode:null,kind:'LIABILITY',presentation:'NON_CURRENT'},
 {code:'3100',parentCode:null,kind:'EQUITY',presentation:'OTHER'},
 {code:'4100',parentCode:null,kind:'REVENUE',presentation:'OTHER'},
 {code:'100001',parentCode:'1000',kind:'ASSET',presentation:'CURRENT'},
];
describe('organization chart presentation hierarchy',()=>{
 it('displays Assets > current and non-current and Liabilities > current and non-current',()=>{
  const tree=accountingPresentationTree(roots);
  const asset=tree.find(g=>g.key==='assets')!,liability=tree.find(g=>g.key==='liabilities')!;
  expect(asset.sections.map(s=>[s.en,s.accounts.map(a=>a.code)])).toEqual([['Current assets',['1000','1100']],['Non-current assets',['1500']]]);
  expect(liability.sections.map(s=>[s.en,s.accounts.map(a=>a.code)])).toEqual([['Current liabilities',['2100']],['Non-current liabilities',['2200']]]);
 });
 it('includes each control account exactly once but never promotes a leaf to a heading',()=>{
  const before=JSON.stringify(roots),tree=accountingPresentationTree(roots);
  const codes=tree.flatMap(g=>g.sections.flatMap(s=>s.accounts.map(a=>a.code)));
  expect(codes.sort()).toEqual(['1000','1100','1500','2100','2200','3100','4100']);
  expect(codes).not.toContain('100001');
  expect(JSON.stringify(roots)).toBe(before);
 });
 it('keeps unrecognized controls visible for accounting review',()=>{
  expect(accountingPresentationTree([{code:'9000',parentCode:null,kind:'OTHER'}]).at(-1)).toMatchObject({key:'other'});
 });
 it('recognizes the deployed policy-and-opening integration phase without implying live statements are approved',()=>{
  const ar=chartIntegrationMessage('POLICY_AND_OPENING','ar');
  const en=chartIntegrationMessage('POLICY_AND_OPENING','en');
  expect(ar).toContain('الأرصدة الافتتاحية');
  expect(ar).toContain('اعتماد الافتتاحي');
  expect(en).toContain('actually posted source vouchers');
  expect(en).toContain('No balance is approved automatically');
  expect(chartIntegrationMessage('POLICY_RULES_ONLY','en')).toContain('not yet available');
  expect(chartIntegrationMessage('NOT_YET_ACTIVE','en')).toContain('not enabled');
  expect(chartIntegrationMessage(undefined,'en')).toContain('not enabled');
 });
});
