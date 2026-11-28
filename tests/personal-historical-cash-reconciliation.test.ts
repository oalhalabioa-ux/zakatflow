import {describe,expect,it} from 'vitest';
import type {CashAccount,CashMovement,RegisterData} from '../lib/financial-register';
import {personalFinancialReports} from '../lib/personal-financial-reports';
import {personalFinancialExportRows} from '../lib/personal-financial-export';
import {personalStatementExport,personalStatementRows} from '../lib/personal-statement-presentation';

const from='2026-03-01',cutoff='2026-03-03',asOf='2026-03-05';
function fixture(gap=0):RegisterData{
  const account=(id:string,currency:string,balance:number):CashAccount=>({
    id,name:id,type:'BANK',currency,nativeCurrency:currency,balance,baseCurrency:currency,baseBalance:balance,
    restricted:0,uncleared:0,organizationId:null,entityId:null,source:'PERSONAL_ASSETS',openingDate:'2026-01-01',
  });
  const movement=(id:string,accountId:string,date:string,amount:number,transactionType:string,currency='SAR'):CashMovement=>({
    id,accountId,date,amount,transactionType,currency,reference:id,source:'ASSETS',description:id,
    ...(transactionType==='OPENING_BALANCE'?{isOpening:true}:{}),
  });
  return {asOf,baseCurrency:'SAR',organizations:[],organizationIds:[],entities:[],assets:[],debts:[],debtMovements:[],warnings:[],
    accounts:[account('main-bank','SAR',1000+gap),account('reconciled-bank','SAR',50),account('usd-bank','USD',100)],
    cashMovements:[
      movement('opening','main-bank','2026-01-01',1000,'OPENING_BALANCE'),
      movement('receipt','main-bank','2026-03-02',200,'ADD'),
      {...movement('receipt-reversal','main-bank','2026-03-04',-200,'REVERSAL'),reversalOfTransactionId:'receipt'},
      movement('other-opening','reconciled-bank','2026-01-01',50,'OPENING_BALANCE'),
      movement('usd-opening','usd-bank','2026-01-01',100,'OPENING_BALANCE','USD'),
    ],
  };
}
const read=(data:RegisterData,to=cutoff)=>personalFinancialReports(data,from,to);
const value=(report:ReturnType<typeof read>,id:string,currency='SAR',en=true)=>
  personalStatementRows(report,'cash-flow',currency,en).find(row=>row.id===id);

describe('personal historical cash requires a reconciled source',()=>{
  it('keeps the dated receipt and later reversal at the correct cutoff',()=>{
    const data=fixture(),before=JSON.stringify(data);
    const early=read(data),later=read(data,'2026-03-04');
    expect(early.historicalPosition.find(row=>row.currency==='SAR')?.cash).toBe('1250.00');
    expect(early.cashAccounts[0]).toMatchObject({opening:'1000.00',closing:'1200.00',netMovement:'200.00'});
    expect(later.cashAccounts[0]).toMatchObject({opening:'1000.00',closing:'1000.00',netMovement:'0.00'});
    expect(value(early,'closing')?.value).toBe('1250');
    expect(value(later,'closing')?.value).toBe('1050');
    expect(JSON.stringify(data)).toBe(before);
  });

  it.each([false,true])('withholds an unmatched balance without dropping real movement or other accounts (English %s)',en=>{
    const report=read(fixture(300));
    expect(report.historicalPosition.find(row=>row.currency==='SAR')?.cash).toBeNull();
    expect(report.cashAccounts[0]).toMatchObject({opening:'',closing:'',inflows:'200.00',outflows:'0.00',netMovement:'200.00'});
    expect(report.issues).toContain('PERSONAL_CASH_HISTORY_RECONCILIATION_REQUIRED');
    expect(value(report,'opening','SAR',en)?.value).toBe('');
    expect(value(report,'closing','SAR',en)?.value).toBe('');
    expect(value(report,'movement','SAR',en)?.value).toBe('200');
    expect(value(report,'account:main-bank','SAR',en)?.value).toBe('');
    expect(value(report,'account:main-bank','SAR',en)?.note).toBeTruthy();
    expect(value(report,'account:reconciled-bank','SAR',en)?.value).toBe('50.00');
    expect(value(report,'closing','USD',en)?.value).toBe('100');
    expect(report.cashByActivity).toContainEqual({currency:'SAR',activity:'UNCLASSIFIED',inflows:'200.00',outflows:'0.00',net:'200.00'});
    const exported=personalStatementExport(report,'cash-flow',en,null);
    const closing=exported.find(row=>row[0]===(en?'Closing cash':'النقد آخر الفترة'));
    expect(closing?.slice(1)).toEqual([value(report,'closing','SAR',en)?.note,'','','','']);
    const legacy=personalFinancialExportRows(report,'cash',en);
    expect(legacy).toContainEqual(['main-bank','SAR','','200.00','0.00','200.00','']);
    expect(legacy).toContainEqual(['reconciled-bank','SAR','50.00','0.00','0.00','0.00','50.00']);
    expect(legacy).toContainEqual(['usd-bank','USD','100.00','0.00','0.00','0.00','100.00']);
    expect(exported.flat()).not.toContain('1500');
    expect(exported.flat()).not.toContain('1300');
  });

  it('does not let a current closing snapshot certify a historical opening',()=>{
    const report=read(fixture(300),asOf);
    expect(report.cashAccounts[0]).toMatchObject({opening:'',closing:'1300.00',inflows:'200.00',outflows:'200.00',netMovement:'0.00'});
    expect(value(report,'opening')?.value).toBe('');
    expect(value(report,'closing')?.value).toBe('1350');
    expect(value(report,'movement')?.value).toBe('0');
    expect(value(report,'account:main-bank')?.note).toBeUndefined();
  });

  it.each(['duplicate','currency','type'] as const)('uses the historical position source guard for %s evidence',kind=>{
    const data=fixture();
    if(kind==='duplicate')data.cashMovements.push({...data.cashMovements[1],amount:0});
    if(kind==='currency')data.cashMovements[1].currency='USD';
    if(kind==='type')data.cashMovements[1].transactionType='UNKNOWN_SOURCE';
    const report=read(data);
    expect(report.historicalPosition.find(row=>row.currency==='SAR')?.cash).toBeNull();
    expect(report.cashAccounts[0]).toMatchObject({opening:'',closing:''});
    expect(value(report,'closing')?.value).toBe('');
    expect(value(report,'closing','USD')?.value).toBe('100');
  });

  it('does not net two account-level reconciliation gaps into a verified currency total',()=>{
    const data=fixture(300);data.accounts[1].balance-=300;data.accounts[1].baseBalance-=300;
    const report=read(data);
    expect(report.cashAccounts.slice(0,2).map(row=>row.closing)).toEqual(['','']);
    expect(value(report,'closing')?.value).toBe('');
    expect(value(report,'movement')?.value).toBe('200');
  });

  it.each([false,true])('preserves a known prior balance without inventing a change against an unknown balance (English %s)',en=>{
    const current=read(fixture(300)),priorData=fixture();
    priorData.asOf=priorData.asOf.replace('2026','2025');
    priorData.cashMovements=priorData.cashMovements.map(row=>({...row,date:row.date.replace('2026','2025')}));
    const prior=personalFinancialReports(priorData,'2025-03-01','2025-03-03');
    const rows=personalStatementExport(current,'cash-flow',en,prior);
    expect(rows.find(row=>row[0]===(en?'Closing cash':'النقد آخر الفترة'))?.slice(2)).toEqual(['','1250','','']);
  });

  it('keeps verified zero balances numeric',()=>{
    const data=fixture();data.accounts=[{...data.accounts[0],balance:0,baseBalance:0}];data.cashMovements=[];
    const report=read(data);
    expect(report.cashAccounts[0]).toMatchObject({opening:'0.00',closing:'0.00',netMovement:'0.00'});
    expect(value(report,'opening')?.value).toBe('0');
    expect(value(report,'closing')?.value).toBe('0');
    expect(value(report,'closing')?.note).toBeUndefined();
  });

  it('keeps future movements in the backwards reconstruction of the current snapshot',()=>{
    const data=fixture();data.accounts[0].balance=1500;data.accounts[0].baseBalance=1500;
    data.cashMovements.push({...data.cashMovements[1],id:'future-receipt',date:'2026-03-06',amount:500});
    const report=read(data,asOf);
    expect(report.cashAccounts[0]).toMatchObject({opening:'',closing:'1000.00',inflows:'200.00',outflows:'200.00',netMovement:'0.00'});
    expect(value(report,'closing')?.value).toBe('1050');
  });
});
