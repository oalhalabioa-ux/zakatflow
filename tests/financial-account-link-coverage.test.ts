import {it,expect} from 'vitest';
import {accountLinkCoverage} from '../lib/financial-account-link-coverage';
const chart=['1000','1500','1590','2100','3300'].flatMap(code=>[{id:code,code,reportingCode:code,cash:code==='1000'},{id:code+'01',code:code+'01',reportingCode:code,cash:code==='1000'}]);
const classes=[{id:'capex',code:'CAPEX',classification_type:'CAPEX',name:'Assets',active:true}];
const rule={eventType:'ASSET_PURCHASE',sourceModule:'OPERATIONAL_CONSOLE',classificationId:'capex:BASE',cashDirection:'NON_CASH' as const,debitAccountId:'1500',creditAccountId:'210001'};
it('distinguishes linked, source-managed, syncable and genuinely missing templates',()=>{
 expect(accountLinkCoverage(chart,classes,[rule]).map(a=>[a.accountCode,a.status])).toEqual([
  ['100001','SOURCE_MANAGED'],['150001','PENDING_SYNC'],['159001','NO_TEMPLATE'],['210001','NEEDS_COMPLETION'],['330001','SOURCE_MANAGED'],
 ]);
});
it('never calls a proposal saved or an inactive/summary account ready',()=>{
 const accounts=[...chart,{id:'150099',code:'150099',reportingCode:'1500',cash:false,isActive:false},{id:'159099',code:'159099',reportingCode:'1590',cash:false,isPostable:false}];
 const coverage=accountLinkCoverage(accounts,classes,[],[{...rule,debitAccountId:'150001'}]);
 expect(coverage.find(a=>a.accountCode==='150001')?.status).toBe('PREPARED');
 expect(coverage).toHaveLength(5);
});

it('requires both detail legs and a valid cash selector before declaring a link complete',()=>{
 const complete={...rule,debitAccountId:'150001'};
 expect(accountLinkCoverage(chart,classes,[complete]).find(a=>a.accountCode==='150001')?.status).toBe('LINKED');
 for(const invalid of [{...complete,creditAccountId:'missing'},{...complete,creditAccountId:'2100'},{...complete,creditAccountId:'150001'}]){
  expect(accountLinkCoverage(chart,classes,[invalid]).find(a=>a.accountCode==='150001')?.status).toBe('NEEDS_COMPLETION');
 }
});
