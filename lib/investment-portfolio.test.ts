import {describe,it,expect} from 'vitest';
import {investmentPortfolio,type PortfolioInstrument,type PortfolioParticipation} from './investment-portfolio';
import {investmentTermsSchema} from './investments';
import {investmentInstrumentReport} from './investment-presentation';

const terms=investmentTermsSchema.parse({name:'Deposit',instrument:'DEPOSIT',ownership_scope:'PERSONAL',party_name:'Bank',currency:'SAR',principal:1000,face_value:1000,fees:0,annual_rate:5,start_date:'2026-01-01',maturity_date:'2027-01-01',interest_basis:'ACT_365',zakat_basis:'HIJRI_354',zakat_rate:0,zakat_base:1000,zakat_treatment:'INVESTOR',inflation_rate:0,fx_rate:1,funding_account_id:'10000000-0000-4000-8000-000000000001'});
const instrument=(id:string,patch:Partial<PortfolioInstrument['terms']>={},status='ACTIVE'):PortfolioInstrument=>({id,status,terms:{...terms,...patch}});
const contract=(patch:Partial<PortfolioParticipation>={}):PortfolioParticipation=>({id:'external',direction:'OUTGOING',state:'ACTIVE',currency:'SAR',reference:'External',maturity_date:'2026-10-20',summary:{managed:300,profitDeclared:80,profitDue:30,returnDue:50},...patch});

describe('investment portfolio',()=>{
 it('reconciles four investment types without adding receivables or incoming financing to invested capital',()=>{
  const instruments=[instrument('d'),instrument('b',{instrument:'BOND',principal:950,fees:10}),instrument('s',{instrument:'SUKUK',principal:2000,face_value:2000}),instrument('draft',{},'DRAFT'),instrument('cancel',{},'CANCELLED')];
  const operations=[{contract_id:'d',kind:'INCOME',status:'POSTED',amount:5},{contract_id:'b',kind:'INCOME',status:'POSTED',amount:2},{contract_id:'s',kind:'INCOME',status:'PREPARED',amount:999},{contract_id:'draft',kind:'INCOME',status:'POSTED',amount:999},{contract_id:'cancel',kind:'INCOME',status:'POSTED',amount:999}];
  const [p]=investmentPortfolio(instruments,operations,[contract(),contract({id:'incoming',direction:'INCOMING'}),contract({id:'draft-contract',state:'DRAFT'}),contract({id:'cancel-contract',state:'CANCELLED'})],'2026-10-21');
  expect(p.invested).toBe(4260);expect(p.projectedIncome).toBe(200);expect(p.declaredIncome).toBe(80);expect(p.settledIncome).toBe(57);expect(p.profitDue).toBe(30);expect(p.returnDue).toBe(50);expect(p.activeCount).toBe(4);expect(p.draftCount).toBe(2);
  expect(p.allocation.map(a=>a.kind)).toEqual(['DEPOSIT','SUKUK','BOND','CONTRACT']);expect(p.allocation[3].projectedIncome).toBeNull();
 });
 it('keeps currencies separate and never uses the recorded FX rate to invent a combined total',()=>{
  const p=investmentPortfolio([instrument('sar'),instrument('usd',{currency:'USD',fx_rate:3.75})],[],[contract({currency:'EUR'})],'2026-10-21');
  expect(p.map(x=>x.currency)).toEqual(['EUR','SAR','USD']);expect(p.find(x=>x.currency==='USD')?.invested).toBe(1000);expect(p.find(x=>x.currency==='SAR')?.invested).toBe(1000);
 });
 it('excludes drafts and cancelled or closed positions from maturity and capital totals while preserving realized income',()=>{
  const [p]=investmentPortfolio([instrument('closed',{},'CLOSED'),instrument('draft',{},'DRAFT'),instrument('cancel',{},'CANCELLED')],[{contract_id:'closed',kind:'INCOME',status:'POSTED',amount:40}],[contract({state:'CLOSED',summary:{managed:0,profitDeclared:20,profitDue:0,returnDue:0}})],'2026-10-21');
  expect(p.invested).toBe(0);expect(p.activeCount).toBe(0);expect(p.maturities).toEqual([]);expect(p.settledIncome).toBe(60);
 });
 it('does not count an unsettled capital return twice',()=>{
  const [p]=investmentPortfolio([],[],[contract({summary:{managed:0,profitDeclared:20,profitDue:20,returnDue:300}})],'2026-10-21');
  expect(p.invested).toBe(0);expect(p.returnDue).toBe(300);expect(p.profitDue).toBe(20);expect(p.maturities).toHaveLength(0);
 });
 it('sorts maturities, marks overdue positions and uses face value rather than the purchase cost',()=>{
  const [p]=investmentPortfolio([instrument('bond',{instrument:'BOND',principal:950,fees:10})],[],[contract()],'2026-10-21');
  expect(p.maturities.map(m=>m.id)).toEqual(['external','bond']);expect(p.maturities[1].amount).toBe(1000);expect(p.maturities[0].estimated).toBe(true);expect(p.overdueCount).toBe(1);
 });
 it('uses decimal arithmetic across instrument and contract balances',()=>{
  const [p]=investmentPortfolio([instrument('tiny',{principal:0.1,face_value:0.1})],[],[contract({summary:{managed:0.2,profitDeclared:0,profitDue:0,returnDue:0}})],'2026-10-21');expect(p.invested).toBe(0.3);
 });
 it('returns a usable empty portfolio in the selected base currency',()=>{
  const [p]=investmentPortfolio([],[],[],'2026-10-21','AED');expect(p.currency).toBe('AED');expect(p.invested).toBe(0);expect(p.activeCount).toBe(0);
 });
 it('exports bonds and sukuk together without dropping either type or including deposits',()=>{
  const report=investmentInstrumentReport([instrument('bond',{instrument:'BOND',name:'Bond'}),instrument('sukuk',{instrument:'SUKUK',name:'Sukuk'}),instrument('deposit')],[],'SECURITIES');
  expect(report.rows).toHaveLength(2);expect(report.rows.map(r=>r[0])).toEqual(['سندات','صكوك']);expect(report.rows.map(r=>r[1])).toEqual(['Bond','Sukuk']);
  for(const row of report.rows)expect(row).toHaveLength(report.columns.length);
  for(const row of report.csvRows)expect(row).toHaveLength(report.csvColumns.length);
 });
});
