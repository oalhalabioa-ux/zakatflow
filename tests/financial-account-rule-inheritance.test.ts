import {describe,it,expect} from 'vitest';
import {inheritAccountPostingRules,type AccountRuleBinding} from '../lib/financial-account-rule-inheritance';
import type {DefaultPostingRule} from '../lib/financial-default-posting-rules';
const roots=['1000','1100','1200','1300','1400','1500','1590','1600','1700','1800','2100','2200','2300','2400','2500','3100','3200','3300','4100','5100','6100','6200','7100','8100'];
const chart=roots.flatMap(code=>[{id:code,code,reportingCode:code,cash:code==='1000'},
 {id:code+'01',code:code+'01',reportingCode:code,cash:code==='1000'}]);
const binding=(root:string):AccountRuleBinding=>({accountCode:root+'01',reportingCode:root,baseClassificationId:'base',classificationId:'child-'+root});
const rule=(debit:string,credit:string):DefaultPostingRule=>({eventType:'ADJUSTMENT',sourceModule:'TEST_SOURCE',classificationId:'base:BASE',cashDirection:'NON_CASH',debitAccountId:debit,creditAccountId:credit});
describe('account rule inheritance',()=>{
 it.each(roots.filter(root=>!['1000','3300'].includes(root)))('inherits either side for %s without changing counterpart or source',root=>{
  const other=root==='2100'?'110001':'210001';
  for(const debitSide of [true,false]){
   const template=debitSide?rule(root,other):rule(other,root);
   const result=inheritAccountPostingRules([binding(root)],chart,[template]);
   expect(result.issues).toEqual([]);
   expect(result.rules).toEqual([{...template,classificationId:'child-'+root+':BASE',
    ...(debitSide?{debitAccountId:root+'01'}:{creditAccountId:root+'01'})}]);
  }
 });
 it.each(['1000','3300'])('delegates %s to its source workflow',root=>{
  expect(inheritAccountPostingRules([binding(root)],chart,[rule(root,'210001')])).toEqual({rules:[],issues:[{accountCode:root+'01',reason:'SOURCE_MANAGED'}]});
 });
 it('uses a configured default leaf but never another classification',()=>{
  expect(inheritAccountPostingRules([binding('6100')],chart,[rule('610001','210001')]).rules[0].debitAccountId).toBe('610001');
  expect(inheritAccountPostingRules([binding('6100')],chart,[{...rule('6100','210001'),classificationId:'different:BASE'}]).rules).toEqual([]);
 });
 it('rejects an inactive account and mismatched group',()=>{
  for(const modified of [chart.map(a=>a.code==='610001'?{...a,isActive:false}:a),chart.map(a=>a.code==='610001'?{...a,reportingCode:'1500'}:a)]){
   expect(inheritAccountPostingRules([binding('6100')],modified,[rule('6100','210001')]).issues[0].reason).toBe('ACCOUNT_INVALID');
  }
 });
 it('preserves explicit edits and is idempotent',()=>{
  const template=rule('6100','210001');
  const first=inheritAccountPostingRules([binding('6100')],chart,[template]);
  expect(inheritAccountPostingRules([binding('6100')],chart,[template],[{...first.rules[0],creditAccountId:'230001'}]).rules).toEqual([]);
 });
 it('rejects two matching legs and invalid counterparts',()=>{
  expect(inheritAccountPostingRules([binding('6100')],chart,[rule('6100','6100')]).issues[0].reason).toBe('AMBIGUOUS_TEMPLATE');
  expect(inheritAccountPostingRules([binding('6100')],chart,[rule('6100','missing')]).issues[0].reason).toBe('COUNTERPART_REQUIRED');
 });
 it('preserves component, cash direction and activity',()=>{
  const template={...rule('2100','1000'),classificationId:'base:PAYMENT',eventType:'SETTLEMENT',cashDirection:'OUTFLOW' as const,cashActivity:'INVESTING' as const};
  expect(inheritAccountPostingRules([binding('2100')],chart,[template]).rules[0]).toEqual({...template,classificationId:'child-2100:PAYMENT',debitAccountId:'210001'});
 });
});

it('does not propagate the ambiguous legacy asset lifecycle BASE signature',()=>{
 const template={...rule('6200','159001'),sourceModule:'ASSET_LIFECYCLE'};
 expect(inheritAccountPostingRules([binding('6200')],chart,[template])).toEqual({rules:[],issues:[{accountCode:'620001',reason:'NO_TEMPLATE'}]});
});
