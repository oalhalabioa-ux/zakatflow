import {describe,expect,it} from 'vitest';
import {personalFinancialReports,PERSONAL_DEFAULT_CHART} from '../lib/personal-financial-reports';
import type {RegisterData} from '../lib/financial-register';

const personal=():RegisterData=>({asOf:'2026-11-06',baseCurrency:'SAR',organizations:[],organizationIds:[],entities:[],warnings:[],
 accounts:[{id:'bank',name:'Personal bank',type:'BANK',currency:'SAR',nativeCurrency:'SAR',balance:1000,restricted:0,uncleared:0,baseCurrency:'SAR',baseBalance:1000,organizationId:null,entityId:null,source:'PERSONAL_ASSETS',openingDate:'2026-01-01'}],
 cashMovements:[
  {id:'receipt',accountId:'bank',date:'2026-10-01',currency:'SAR',amount:200,source:'ASSETS',description:'transfer received',reference:'r'},
  {id:'spend',accountId:'bank',date:'2026-10-02',currency:'SAR',amount:-100,source:'ASSETS',description:'payment',reference:'p'},
 ],
 debts:[{id:'receivable',partyKey:'a',partyName:'Borrower',organizationId:null,entityId:null,side:'RECEIVABLE',currency:'SAR',amount:200,dueDate:null,date:'2026-01-01',description:'Receivable',source:'PERSONAL_ASSETS',eventId:null},
 {id:'payable',partyKey:'b',partyName:'Lender',organizationId:null,entityId:null,side:'PAYABLE',currency:'SAR',amount:100,dueDate:null,date:'2026-01-01',description:'Payable',source:'PERSONAL_PAYABLE',eventId:null}],
 debtMovements:[],
 assets:[{id:'gold',name:'Gold',type:'GOLD',currency:'SAR',cost:400,market:500,organizationId:null,entityId:null,category:'ASSET',source:'ASSETS'}],
});

describe('independent read-only personal financial reports',()=>{
 it('uses an automatic simple category map and reconciles net worth without company accounts',()=>{
  const r=personalFinancialReports(personal(),'2026-10-01','2026-11-06');
  expect(r).toMatchObject({scope:'PERSONAL',basis:'CURRENT_PERSONAL_REGISTER_ESTIMATE',asOf:'2026-11-06',
   positions:[{currency:'SAR',cash:'1000.00',receivables:'200.00',otherAssets:'500.00',liabilities:'100.00',netWorth:'1600.00',complete:true}],
   cashAccounts:[{id:'bank',opening:'900.00',inflows:'200.00',outflows:'100.00',closing:'1000.00',netMovement:'100.00'}]});
  expect(r.categories.map(c=>c.code)).toEqual(['1000','1100','2100','P-OTHER']);
  expect(r).not.toHaveProperty('organizationId');
  expect(PERSONAL_DEFAULT_CHART.some(c=>c.code==='4100')).toBe(false); // Income is not inferred from a deposit.
  expect(r.issues).toContain('PERSONAL_INCOME_EXPENSE_CLASSIFICATION_PENDING');
 });
 it('separates currency totals and refuses an unconverted net-worth grand total',()=>{
  const d=personal();d.assets.push({id:'usd',name:'USD investment',type:'STOCK',currency:'USD',cost:50,market:75,organizationId:null,entityId:null,category:'INVESTMENT',source:'INVESTMENTS'});
  const r=personalFinancialReports(d,'2026-01-01','2026-11-06');
  expect(r.positions.map(p=>[p.currency,p.netWorth])).toEqual([['SAR','1600.00'],['USD','75.00']]);
  expect(r.issues).toContain('PERSONAL_MULTI_CURRENCY_NOT_AGGREGATED');
 });
 it("uses loan reporting parents without treating personal valuables as corporate fixed equipment",()=>{
  const d=personal();d.debts[0].category='P_AR_LOAN';d.debts[1].category='P_AP_LOAN';
  const codes=personalFinancialReports(d,'2026-01-01','2026-11-06').categories.map(c=>c.code);
  expect(codes).toContain('1200');expect(codes).toContain('2200');expect(codes).toContain('P-OTHER');
  expect(codes).not.toContain('1500');
 });
 it('withholds net worth when personal source contains unreconciled old balances',()=>{
  const d=personal();d.assets.push({id:'old',name:'Legacy',type:'CASH',currency:'SAR',cost:10,market:10,organizationId:null,entityId:null,category:'LEGACY_CASH',source:'ASSETS'});
  const r=personalFinancialReports(d,'2026-01-01','2026-11-06');
  expect(r.positions[0]).toMatchObject({netWorth:null,complete:false,unreconciled:1});
  expect(r.issues).toContain('PERSONAL_POSITION_RECONCILIATION_REQUIRED');
 });
 it('does not certify personal net worth when contract schedules are incomplete',()=>{
  const d=personal();d.warnings=['PERSONAL_CONTRACT_SCHEDULE_UNAVAILABLE'];
  const r=personalFinancialReports(d,'2026-01-01','2026-11-06');
  expect(r.positions[0]).toMatchObject({netWorth:null,complete:false});
  expect(r.issues).toContain('PERSONAL_CONTRACT_SCHEDULE_UNAVAILABLE');
 });
 it('rejects a nonpersonal source, an entity assignment or a future reporting period',()=>{
  const d=personal();d.accounts[0].organizationId='org';
  expect(()=>personalFinancialReports(d,'2026-01-01','2026-11-06')).toThrow('PERSONAL_REPORT_SCOPE_INVALID');
  d.accounts[0].organizationId=null;d.organizationIds=['org'];
  expect(()=>personalFinancialReports(d,'2026-01-01','2026-11-06')).toThrow('PERSONAL_REPORT_SCOPE_INVALID');
  d.organizationIds=[];
  expect(()=>personalFinancialReports(d,'2026-11-07','2026-11-08')).toThrow('PERSONAL_REPORT_PERIOD_INVALID');
 });
 it('does not turn transfers into revenue, and keeps each cash account opening and closing balanced',()=>{
  const d=personal();d.accounts.push({...d.accounts[0],id:'cash',name:'Cash',balance:300,baseBalance:300});
  d.cashMovements=[{id:'out',accountId:'bank',date:'2026-11-01',currency:'SAR',amount:-150,description:'Internal transfer',reference:'x',source:'ASSETS'},
   {id:'in',accountId:'cash',date:'2026-11-01',currency:'SAR',amount:150,description:'Internal transfer',reference:'x',source:'ASSETS'}];
  const r=personalFinancialReports(d,'2026-11-01','2026-11-06');
  expect(r.cashAccounts.map(c=>c.netMovement)).toEqual(['-150.00','150.00']);
  expect(r.issues).toContain('PERSONAL_CASH_GROSS_INCLUDES_INTERNAL_TRANSFERS');
  expect(JSON.stringify(r)).not.toMatch(/revenueTotal|netProfit/);
 });
});
