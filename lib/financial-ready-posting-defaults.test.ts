import {describe,it,expect} from 'vitest';
import {readyPostingDefaults} from './financial-ready-posting-defaults';
import {defaultPostingRules,type PostingClassification} from './financial-default-posting-rules';
const roots=['1000','1100','2100','4100','6100'];
const chart=[...roots.map(code=>({id:code,code,cash:code==='1000'})),...['110001','110002','210001','410001','610001','610002'].map(code=>({id:code,code,reportingCode:code.slice(0,4),cash:false}))];
const c:PostingClassification[]=[{id:'revenue',code:'REVENUE',name:'Revenue',classification_type:'REVENUE',active:true},{id:'expense',code:'OPEX_ACCOUNT_610001',name:'Rent',classification_type:'OPEX',active:true}];
const roles={'1100':'110001','2100':'210001','4100':'410001','6100':'610002'};
describe('ready organization defaults',()=>{
 it('uses the customer control despite multiple receivable children and completes both legs',()=>{
  const r=readyPostingDefaults(c,chart,[],[],roles);expect(r.issue).toBeNull();
  expect(r.rules.find(r=>r.eventType==='REVENUE')).toMatchObject({debitAccountId:'110001',creditAccountId:'410001',detailed:true});
  expect(r.rules.find(r=>r.eventType==='EXPENSE')).toMatchObject({debitAccountId:'610001',creditAccountId:'210001',detailed:true});
  expect(r.rules.find(r=>r.eventType==='SETTLEMENT')).toMatchObject({debitAccountId:'1000',creditAccountId:'110001'});
 });
 it('repairs legacy parents while preserving explicit custom leaf mappings',()=>{
  const base=defaultPostingRules(c,chart,[],[],roles).rules;
  const legacy=base.map(r=>({...r,debitAccountId:r.eventType==='REVENUE'?'1100':r.debitAccountId}));
  const ready=readyPostingDefaults(c,chart,[],legacy,roles);expect(ready.issue).toBeNull();
  expect(ready.rules.find(r=>r.eventType==='REVENUE')?.debitAccountId).toBe('110001');
  legacy[0].debitAccountId='110002';
  expect(readyPostingDefaults(c,chart,[],legacy,roles).rules[0].debitAccountId).toBe('110002');
 });
 it('is idempotent and never guesses a missing or inactive user account',()=>{
  const first=readyPostingDefaults(c,chart,[],[],roles);
  expect(readyPostingDefaults(c,chart,[],first.rules,roles).rules).toEqual(first.rules);
  const broken=first.rules.map((r,i)=>i===0?{...r,debitAccountId:'missing'}:r);
  expect(readyPostingDefaults(c,chart,[],broken,roles).issue).toBe('REPORTING_POLICY_ACCOUNT_INVALID');
 });
 it('keeps loan and employee defaults separate from trade receivables',()=>{
  const native:PostingClassification[]=[{id:'debt',code:'DEBT_PRINCIPAL_ASSET',name:'Debt',classification_type:'ASSET',active:true}];
  const expanded=[...chart,{id:'120001',code:'120001',reportingCode:'1200',cash:false}];
  const r=readyPostingDefaults(native,expanded,[],[],{...roles,'1200':'120001',EMPLOYEE:'110002'});
  expect(r.issue).toBeNull();expect(r.rules.map(r=>r.debitAccountId)).toEqual(['120001','110002']);
 });
});
