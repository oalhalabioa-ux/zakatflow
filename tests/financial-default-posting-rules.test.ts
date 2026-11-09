import {describe,it,expect} from 'vitest';
import {defaultPostingRules,postingRuleKey,type PostingClassification} from '../lib/financial-default-posting-rules';
import {financialPostingCoverage} from '../lib/financial-posting-coverage';
import {validatePostingRuleAccounts} from '../lib/financial-posting-rule-validation';
const chart=['1000','1100','1400','1500','1600','2100','2300','4100','6100','8100'].map(code=>({id:code,code,cash:code==='1000',isActive:true,isPostable:true}));
const cls=(type:string,id=type):PostingClassification=>({id,code:type,name:type,classification_type:type,active:true});
describe('organization default posting rules',()=>{
 it('prepares valid editable recognition and settlement mappings with no operations',()=>{
  const d=defaultPostingRules(['OPEX','REVENUE','CAPEX','INVESTMENT','TAX','ZAKAT','PAYABLE','RECEIVABLE'].map(v=>cls(v)),chart);
  expect(d.rules.length).toBeGreaterThan(14);expect(d.testedRuleCount).toBe(0);expect(d.unresolved).toEqual([]);
  expect(validatePostingRuleAccounts(d.rules,chart)).toBeNull();expect(new Set(d.rules.map(postingRuleKey)).size).toBe(d.rules.length);
  expect(d.rules.find(r=>r.eventType==='SETTLEMENT'&&r.classificationId==='OPEX:BASE')).toMatchObject({debitAccountId:'2100',creditAccountId:'1000'});
 });
 it('uses each organization’s own postable leaf and excludes inactive/summary accounts',()=>{
  const a=defaultPostingRules([cls('OPEX','org-a')],[...chart,{id:'610011',code:'610011',reportingCode:'6100',cash:false}]);
  const b=defaultPostingRules([cls('OPEX','org-b')],[...chart,{id:'610021',code:'610021',reportingCode:'6100',cash:false},{id:'610099',code:'610099',cash:false,isActive:false},{id:'610088',code:'610088',cash:false,isPostable:false}]);
  expect(a.rules[0]).toMatchObject({classificationId:'org-a:BASE',debitAccountId:'610011'});expect(b.rules[0]).toMatchObject({classificationId:'org-b:BASE',debitAccountId:'610021'});
 });
 it('keeps an explicit control account when multiple children exist; leaves missing accounts unresolved',()=>{
  const children=[{id:'610011',code:'610011',cash:false},{id:'610021',code:'610021',cash:false}];
  expect(defaultPostingRules([cls('OPEX')],[...chart,...children]).rules[0].debitAccountId).toBe('6100');
  const d=defaultPostingRules([cls('OPEX')],[...chart.filter(a=>a.code!=='6100'),...children]);expect(d.unresolved.length).toBeGreaterThan(0);expect(d.rules.some(r=>r.eventType==='EXPENSE')).toBe(false);
 });
 it('does not overwrite saved edits or duplicate signatures and ignores inactive classifications',()=>{
  const original=defaultPostingRules([cls('OPEX')],chart).rules;
  const edited={...original[0],debitAccountId:'1500'};
  const d=defaultPostingRules([cls('OPEX'),{...cls('REVENUE'),active:false}],chart,[],[edited,...original.slice(1)]);
  expect(d.rules).toEqual([]);expect(edited.debitAccountId).toBe('1500');
 });
 it('maps actual native source signatures while keeping unsupported source modules unconfigured',()=>{
  const event={id:'e',organizationId:'org',currency:'SAR',date:'2026-11-08',eventType:'EXPENSE',sourceModule:'OPERATIONAL_CONSOLE',sourceKey:'k',status:'ACTUAL' as const,lines:[{id:'l',classificationId:'OPEX:BASE',baseAmount:'100',cashDirection:'NON_CASH' as const,recognitionSign:1 as const}]};
  const d=defaultPostingRules([cls('OPEX')],chart,[event]);expect(d.testedRuleCount).toBe(1);expect(financialPostingCoverage([event],d.rules).missingLines).toBe(0);
  expect(financialPostingCoverage([{...event,sourceModule:'CUSTOM_UNKNOWN'}],d.rules).missingLines).toBe(1);
 });
 it('suggests only expense recognition for an explicit operating expense detail',()=>{
  const detail={...cls('OPEX','rent'),code:'OPEX_RENT'};
  const rules=defaultPostingRules([cls('OPEX'),detail],chart).rules;
  expect(rules.filter(rule=>rule.classificationId.startsWith('rent:'))).toEqual([
   expect.objectContaining({eventType:'EXPENSE',sourceModule:'OPERATIONAL_CONSOLE',classificationId:'rent:BASE'}),
  ]);
  expect(rules.some(rule=>rule.classificationId==='OPEX:NET_RECOGNITION')).toBe(true);
 });
 it('covers native asset and investment purchases and preserves legacy expense rules',()=>{
  const purchase=(type:string,eventType:string)=>({
   id:type+eventType,organizationId:'org',currency:'SAR',date:'2026-11-08',eventType,
   sourceModule:'OPERATIONAL_CONSOLE',sourceKey:type+eventType,status:'ACTUAL' as const,
   lines:[{id:type+eventType,classificationId:type+':BASE',baseAmount:'100',
    cashDirection:'NON_CASH' as const,recognitionSign:1 as const}],
  });
  const events=[purchase('CAPEX','ASSET_PURCHASE'),purchase('INVESTMENT','ASSET_PURCHASE')];
  const classes=[cls('CAPEX'),cls('INVESTMENT')];
  const proposed=defaultPostingRules(classes,chart,events).rules;
  expect(financialPostingCoverage(events,proposed).missingLines).toBe(0);
  expect(proposed.filter(rule=>rule.eventType==='ASSET_PURCHASE').map(rule=>rule.debitAccountId))
   .toEqual(['1500','1600']);
  expect(proposed.some(rule=>rule.eventType==='EXPENSE')).toBe(false);
  const legacy=purchase('CAPEX','EXPENSE');
  const legacyRule=defaultPostingRules(classes,chart,[legacy]).rules.find(rule=>rule.eventType==='EXPENSE')!;
  expect(legacyRule.debitAccountId).toBe('1500');
  const newRules=defaultPostingRules(classes,chart,[...events,legacy],[legacyRule]).rules;
  expect(newRules.some(rule=>rule.eventType==='EXPENSE')).toBe(false);
  expect(financialPostingCoverage([...events,legacy],[legacyRule,...newRules]).missingLines).toBe(0);
 });
 it('keeps recoverable and nonrecoverable VAT separate from income tax and does not invent classifications',()=>{
  const d=defaultPostingRules([cls('TAX')],chart);expect(d.rules.find(r=>r.classificationId==='TAX:INPUT_VAT_RECOVERABLE')?.debitAccountId).toBe('1400');
  expect(d.rules.find(r=>r.classificationId==='TAX:INPUT_VAT_NONRECOVERABLE')?.debitAccountId).toBe('6100');
  expect(d.rules.find(r=>r.classificationId==='TAX:BASE')?.debitAccountId).toBe('8100');expect(defaultPostingRules([],chart).rules).toEqual([]);
 });
});

it('uses the recorded reporting parent before a similar account number',()=>{
 const result=defaultPostingRules([cls('OPEX')],[...chart,
  {id:'610099',code:'610099',reportingCode:'1500',cash:false},
  {id:'rent-account',code:'RENT',reportingCode:'6100',cash:false}]);
 expect(result.rules.find(rule=>rule.eventType==='EXPENSE'&&rule.sourceModule==='OPERATIONAL_CONSOLE')?.debitAccountId).toBe('rent-account');
});
