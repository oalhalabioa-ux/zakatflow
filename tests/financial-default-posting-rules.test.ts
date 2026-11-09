import {describe,it,expect} from 'vitest';
import {defaultPostingRules,postingRuleKey,type PostingClassification} from '../lib/financial-default-posting-rules';
import {financialPostingCoverage} from '../lib/financial-posting-coverage';
import {validatePostingRuleAccounts,detailedPostingDraft,validateDetailedPostingRule} from '../lib/financial-posting-rule-validation';
const chart=['1000','1100','1400','1500','1590','1600','2100','2300','4100','6100','6200','8100'].map(code=>({id:code,code,cash:code==='1000',isActive:true,isPostable:true}));
const cls=(type:string,id=type):PostingClassification=>({id,code:type,name:type,classification_type:type,active:true});
describe('organization default posting rules',()=>{
 it('requires depreciation expense and accumulated depreciation leaves before approving the complete lifecycle policy',()=>{
  const classifications=['OPEX','REVENUE','CAPEX','INVESTMENT','TAX','ZAKAT','PAYABLE','RECEIVABLE','ASSET'].map(v=>cls(v));
  const roots=['1100','1400','1500','1600','2100','2300','4100','6100','8100'];
  const leaf=(root:string)=>({id:root+'01',code:root+'01',reportingCode:root,cash:false,isActive:true,isPostable:true});
  const incomplete=[...chart,...roots.map(leaf)];
  const invalid=defaultPostingRules(classifications,incomplete).rules.map(r=>detailedPostingDraft(r,incomplete)).filter(r=>validateDetailedPostingRule(r,incomplete));
  expect(invalid.map(r=>r.classificationId)).toEqual(expect.arrayContaining(['OPEX:DEPRECIATION','ASSET:ACCUMULATED_DEPRECIATION_RELEASE']));
  const complete=[...incomplete,leaf('1590'),leaf('6200')];
  const rules=defaultPostingRules(classifications,complete).rules.map(r=>detailedPostingDraft(r,complete));
  expect(rules.filter(r=>validateDetailedPostingRule(r,complete))).toEqual([]);
 });
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
  expect(proposed.filter(rule=>rule.eventType==='ASSET_PURCHASE'&&rule.sourceModule==='OPERATIONAL_CONSOLE').map(rule=>rule.debitAccountId))
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

it('binds an automatically generated expense classification to its own leaf',()=>{
 const detail={...cls('OPEX','rent'),code:'OPEX_ACCOUNT_610002'};
 const accounts=[...chart,{id:'610001',code:'610001',reportingCode:'6100',cash:false},
  {id:'610002',code:'610002',reportingCode:'6100',cash:false}];
 expect(defaultPostingRules([detail],accounts).rules[0].debitAccountId).toBe('610002');
 const missing=defaultPostingRules([detail],chart);
 expect(missing.rules).toEqual([]);
 expect(missing.unresolved).toHaveLength(1);
});


it('rejects generated expense mappings to a control or another reporting group',()=>{
 for(const [code,reportingCode] of [['150001','1500'],['610099','1500'],['6100','6100']]){
  const detail={...cls('OPEX','invalid'),code:'OPEX_ACCOUNT_'+code};
  const accounts=[...chart.filter(a=>a.code!==code),{id:code,code,reportingCode,cash:false}];
  const result=defaultPostingRules([detail],accounts);
  expect(result.rules).toEqual([]);
  expect(result.unresolved).toHaveLength(1);
 }
});


it('inherits generated revenue detail from the saved default, preserving its receivable',()=>{
 const base=cls('REVENUE','base-revenue');
 const child={...cls('REVENUE','service-revenue'),code:'REVENUE_ACCOUNT_410001',metadata:{accountInheritance:{accountCode:'410001',reportingCode:'4100',baseClassificationId:base.id,classificationId:'service-revenue'}}};
 const accounts=[...chart,{id:'410001',code:'410001',reportingCode:'4100',cash:false},{id:'110002',code:'110002',reportingCode:'1100',cash:false}];
 const configured={eventType:'REVENUE',sourceModule:'OPERATIONAL_CONSOLE',classificationId:base.id+':BASE',cashDirection:'NON_CASH' as const,debitAccountId:'110002',creditAccountId:'4100'};
 const result=defaultPostingRules([base,child],accounts,[],[configured]);
 expect(result.rules.find(r=>r.classificationId==='service-revenue:BASE')).toEqual({...configured,classificationId:'service-revenue:BASE',creditAccountId:'410001'});
 expect(result.inheritanceIssues).toEqual([]);
});

it('maps native capitalized acquisition cost and recoverable VAT exactly once',()=>{
 const rules=defaultPostingRules(['CAPEX','INVESTMENT','TAX'].map(c=>cls(c)),chart).rules.filter(r=>r.sourceModule==='ASSETS_INTEGRATION');
 expect(rules.map(r=>[r.classificationId,r.debitAccountId,r.creditAccountId])).toEqual([['CAPEX:BASE','1500','2100'],['INVESTMENT:BASE','1600','2100'],['TAX:BASE','1400','2100']]);
 expect(rules.every(r=>r.eventType==='ASSET_PURCHASE'&&r.cashDirection==='NON_CASH')).toBe(true);
});

it('routes dedicated advance and finance sources without creating generic console mappings',()=>{
 const classes=[['ADVANCE_SUPPLIER_ASSET','ASSET'],['ADVANCE_CUSTOMER_LIABILITY','LIABILITY'],['CONTRACT_FINANCE_COST','OPEX'],['CONTRACT_FINANCE_RETURN','REVENUE'],['ADVANCE_PAYABLE_CLEARING','PAYABLE'],['ADVANCE_RECEIVABLE_CLEARING','RECEIVABLE']].map(([code,type])=>({...cls(type,code),code}));
 const extended=[...chart,...['1300','2400','7100'].map(code=>({id:code,code,cash:false,isActive:true,isPostable:true}))];
 const rules=defaultPostingRules(classes,extended).rules;
 expect(rules.map(r=>[r.sourceModule,r.eventType,r.cashDirection,r.debitAccountId,r.creditAccountId])).toEqual([
  ['ADVANCE_WORKSPACE','SETTLEMENT','OUTFLOW','1300','1000'],
  ['ADVANCE_WORKSPACE','SETTLEMENT','INFLOW','1000','2400'],
  ['FINANCE_CONTRACTS','EXPENSE','NON_CASH','7100','2100'],
  ['FINANCE_CONTRACTS','REVENUE','NON_CASH','1100','4100'],
 ]);
 const events=rules.map((r,i)=>({id:String(i),organizationId:'org',currency:'SAR',date:'2026-11-01',eventType:r.eventType,sourceModule:r.sourceModule,sourceKey:String(i),status:'ACTUAL' as const,lines:[{id:String(i),classificationId:r.classificationId,cashDirection:r.cashDirection,baseAmount:'100',recognitionSign:1 as const}]}));
 expect(financialPostingCoverage(events,rules).missingLines).toBe(0);
 expect(defaultPostingRules(classes,extended,[],rules).rules).toEqual([]);
 expect(defaultPostingRules(classes,extended.filter(a=>a.code!=='7100')).unresolved.some(r=>r.classificationId==='CONTRACT_FINANCE_COST:BASE')).toBe(true);
});

it('separates funded loan and employee principal from opening debt without inventing an opening counterpart',()=>{
 const classes=[{...cls('ASSET','debt-asset'),code:'DEBT_PRINCIPAL_ASSET'},{...cls('LIABILITY','debt-liability'),code:'DEBT_PRINCIPAL_LIABILITY'}];
 const extended=[...chart,...['1200','2200'].map(code=>({id:code,code,cash:false,isActive:true,isPostable:true}))];
 const rules=defaultPostingRules(classes,extended).rules;
 expect(rules.map(r=>[r.classificationId,r.cashDirection,r.debitAccountId,r.creditAccountId,r.cashActivity])).toEqual([
 ['debt-asset:DEBT_FUNDED_O_AR_LOAN','OUTFLOW','1200','1000','INVESTING'],
 ['debt-asset:DEBT_FUNDED_O_AR_EMPLOYEE','OUTFLOW','1100','1000','OPERATING'],
 ['debt-liability:DEBT_FUNDED_O_AP_LOAN','INFLOW','1000','2200','FINANCING'],
 ]);
 expect(rules.some(r=>r.cashDirection==='NON_CASH'||r.classificationId.endsWith(':BASE'))).toBe(false);
 const edited={...rules[0],debitAccountId:'120001'};
 expect(defaultPostingRules(classes,extended,[],[edited,...rules.slice(1)]).rules).toEqual([]);
});
