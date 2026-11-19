import {describe,expect,it} from 'vitest';
import {acquisitionFairValueDifferences} from '../lib/financial-group-acquisition-fair-value';

const accounts=[
 {id:'150001',kind:'ASSET',balance:'1000'},
 {id:'210001',kind:'LIABILITY',balance:'-400'},
 {id:'250001',kind:'LIABILITY',balance:'0'},
 {id:'100001',kind:'ASSET',balance:'500',cash:true},
];
const items=[
 {id:'150001',kind:'ASSET',recognizedAmount:'1200'},
 {id:'210001',kind:'LIABILITY',recognizedAmount:'350'},
 {id:'250001',kind:'LIABILITY',recognizedAmount:'40'},
 {id:'100001',kind:'ASSET',recognizedAmount:'500'},
] as const;
describe('dated acquisition differences',()=>{
 it('separates asset uplift, a lower liability and a newly recognized liability',()=>{
  const result=acquisitionFairValueDifferences(accounts,items,true);
  expect(result.status).toBe('ELIGIBLE');
  if(result.status==='ELIGIBLE')expect(result.adjustments.map(a=>[a.accountId,a.kind,a.adjustment])).toEqual([
   ['150001','ASSET','200.0000'],['210001','LIABILITY','-50.0000'],['250001','LIABILITY','40.0000'],
  ]);
 });
 it('requires a tax assessment for differences, even when net differences cancel',()=>{
  const offset=[{...items[0],recognizedAmount:'1040'},{...items[1],recognizedAmount:'440'},items[3]];
  expect(acquisitionFairValueDifferences(accounts,offset,false).status).toBe('FAIR_VALUE_TAX_BASIS_REQUIRED');
 });
 it('refuses missing accounts, cross-kind mappings and revaluation of cash',()=>{
  expect(acquisitionFairValueDifferences(accounts,items.slice(1),true).status).toBe('FAIR_VALUE_MAPPING_REQUIRED');
  expect(acquisitionFairValueDifferences(accounts,[{...items[0],kind:'LIABILITY'},...items.slice(1)],true).status).toBe('FAIR_VALUE_MAPPING_REQUIRED');
  expect(acquisitionFairValueDifferences(accounts,[...items.slice(0,3),{...items[3],recognizedAmount:'501'}],true).status).toBe('FAIR_VALUE_ACCOUNT_UNSUPPORTED');
 });
});
