import {describe,expect,it} from 'vitest';
import {equityOpeningAccounts,openingEquityExtraRows} from '../lib/financial-opening-equity';
import type {OpeningWorkspaceData} from '../lib/financial-opening-workspace';
import type {OpeningItem} from '../lib/financial-opening-preview';

const chart=[
 {id:'310001',code:'310001',ar:'رأس مال الشريك 1',en:'Partner 1 capital',kind:'EQUITY',cash:false,presentation:'EQUITY',reportingCode:'3100',parentCode:'3100'},
 {id:'310002',code:'310002',ar:'رأس مال الشريك 2',en:'Partner 2 capital',kind:'EQUITY',cash:false,presentation:'EQUITY',reportingCode:'3100',parentCode:'3100'},
 {id:'320001',code:'320001',ar:'احتياطي نظامي',en:'Statutory reserve',kind:'EQUITY',cash:false,presentation:'EQUITY',reportingCode:'3200',parentCode:'3200'},
 {id:'330001',code:'330001',ar:'أرباح مرحلة',en:'Retained earnings',kind:'EQUITY',cash:false,presentation:'EQUITY',reportingCode:'3300',parentCode:'3300'},
] satisfies OpeningWorkspaceData['chart'];
const sources:OpeningItem[]=[
 {id:'equity:3100',tab:'equity',accountCode:'3100',ar:'رأس المال',en:'Capital',accountAr:'رأس المال',accountEn:'Capital',normal:'CREDIT',vouchers:[]},
 {id:'equity:3200',tab:'equity',accountCode:'3200',ar:'احتياطيات',en:'Reserves',accountAr:'احتياطيات',accountEn:'Reserves',normal:'CREDIT',vouchers:[]},
];

describe('opening equity child accounts',()=>{
 it('keeps the existing partner allocation and offers partner 2 and statutory reserve',()=>{
  const entries={'equity:3100':{amount:'3000000',side:'CREDIT' as const,accountCode:'310001'},'equity:3200':{amount:'100000',side:'CREDIT' as const}};
  expect(equityOpeningAccounts(chart,[...sources],entries).map(a=>a.code)).toContain('310002');
  expect(equityOpeningAccounts(chart,[...sources],entries).map(a=>a.code)).toContain('320001');
  expect(equityOpeningAccounts(chart,[...sources],entries).map(a=>a.code)).not.toContain('310001');
 });
 it('renders an independent partner entry after saving/reloading the draft',()=>{
  const entries={'equity:3100':{amount:'3000000',side:'CREDIT' as const,accountCode:'310001'},'equity-child:310002':{amount:'120000',side:'CREDIT' as const}};
  const rows=openingEquityExtraRows(chart,entries);
  expect(rows).toEqual([expect.objectContaining({id:'equity-child:310002',accountCode:'310002',ar:'رأس مال الشريك 2',vouchers:[]})]);
  expect(equityOpeningAccounts(chart,[...sources],entries).map(a=>a.code)).not.toContain('310002');
 });
 it('does not synthesize balances for unadded accounts',()=>{
  expect(openingEquityExtraRows(chart,{})).toEqual([]);
  expect(openingEquityExtraRows(chart,{'equity-child:999999':{amount:'50',side:'CREDIT'}})).toEqual([]);
 });
});
