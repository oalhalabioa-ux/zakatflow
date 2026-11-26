import {describe,expect,it} from 'vitest';
import {personalHistoricalValuation,personalReportEvidence} from '../lib/personal-report-evidence';
import {personalFinancialReports} from '../lib/personal-financial-reports';
import {personalFinancialExportRows} from '../lib/personal-financial-export';
import type {RegisterData,CashMovement} from '../lib/financial-register';

const asOf='2026-11-26',cutoff='2026-10-31';
function evidenceFixture(){
 const cash=(id:string,date:string,amount:number,transactionType:string):CashMovement=>({
  id,accountId:'bank',date,amount,transactionType,currency:'SAR',source:'ASSETS',description:'Fixture',reference:id,
 });
 const data:RegisterData={asOf,baseCurrency:'SAR',organizations:[],organizationIds:[],entities:[],warnings:[],
  accounts:[{id:'bank',name:'Bank',type:'BANK',currency:'SAR',nativeCurrency:'USD',balance:1185,baseCurrency:'SAR',baseBalance:1185,
   organizationId:null,entityId:null,restricted:0,uncleared:0,source:'PERSONAL_ASSETS',openingDate:'2026-01-01'}],
  cashMovements:[
   {...cash('opening','2026-01-01',1000,'OPENING_BALANCE'),isOpening:true},
   cash('loan','2026-10-01',200,'ADD'),
   cash('asset-payment','2026-10-05',-75,'WITHDRAWAL'),
   cash('unexplained','2026-10-07',20,'ADD'),
   cash('advance','2026-10-09',-35,'WITHDRAWAL'),
   {...cash('undo','2026-11-01',75,'REVERSAL'),reversalOfTransactionId:'asset-payment'},
  ], debts:[],debtMovements:[],assets:[],
 };
 const tx=(id:string,account:string,date:string,type:string,value:number,metadata:Record<string,unknown>={})=>({
  id,asset_account_id:account,transaction_date:date,transaction_type:type,currency:'SAR',base_currency:'SAR',gross_value:value,quantity:value,base_value:value,metadata,
 });
 const source:Parameters<typeof personalReportEvidence>[1]={
  contracts:[
   {id:'financing',product:'FINANCING',side:'RECEIVABLE',status:'POSTED',currency:'SAR'},
   {id:'participation',product:'PARTICIPATION',side:'PAYABLE',status:'POSTED',currency:'SAR'},
  ],
  movements:[
   {id:'charge',contract_id:'financing',request_id:'charge-request',kind:'CHARGE',amount:'5.25',operation_date:'2026-10-08',asset_id:'receivable',
    payable_id:null,transaction_ids:['charge-tx'],reversed_at:'2026-11-02T09:30:00Z',reversal_date:'2026-11-02'},
   {id:'profit',contract_id:'participation',request_id:'profit-request',kind:'PROFIT',amount:'6',operation_date:'2026-10-10',asset_id:null,
    payable_id:'payable',transaction_ids:[],reversed_at:null,reversal_date:null},
  ],
  funding:[{cash_transaction_id:'loan',kind:'LOAN',side:'PAYABLE'},{cash_transaction_id:'advance',kind:'ADVANCE',side:'RECEIVABLE'}],
  investments:[],
  transactions:[
   tx('loan','bank','2026-10-01','ADD',200),
   tx('advance','bank','2026-10-09','WITHDRAWAL',35),
   tx('asset-payment','bank','2026-10-05','WITHDRAWAL',75,{source:'ASSET_PURCHASE',purchase_transaction_id:'asset'}),
   tx('asset','investment','2026-10-05','PURCHASE',75,{funding_account_id:'bank'}),
   tx('charge-tx','receivable','2026-10-08','OPENING_BALANCE',5.25,{personal_contract_id:'financing'}),
  ],
  payables:[{id:'payable',request_id:'profit-request',event_date:'2026-10-10',amount:'6',currency:'SAR'}],
 };
 return {data,source};
}

describe('personal statements read and reconcile source-linked evidence',()=>{
 it('separates financing, investment and operating cash from unclassified amounts and recognizes contract sources only',()=>{
  const {data,source}=evidenceFixture();
  const report=personalFinancialReports(data,'2026-10-01',cutoff,personalReportEvidence(data,source));
  expect(report.cashByActivity).toEqual([
   {currency:'SAR',activity:'OPERATING',inflows:'0.00',outflows:'35.00',net:'-35.00'},
   {currency:'SAR',activity:'INVESTING',inflows:'0.00',outflows:'75.00',net:'-75.00'},
   {currency:'SAR',activity:'FINANCING',inflows:'200.00',outflows:'0.00',net:'200.00'},
   {currency:'SAR',activity:'UNCLASSIFIED',inflows:'20.00',outflows:'0.00',net:'20.00'},
  ]);
  expect(report.recognizedIncome.map(r=>[r.category,r.amount])).toEqual([['FINANCE_INCOME','5.25'],['PARTICIPATION_EXPENSE','6']]);
  expect(personalFinancialExportRows(report,'income',true)).toContainEqual(['2026-10-08','Finance income','SAR','5.25','charge']);
  expect(report.historicalPosition).toEqual([{currency:'SAR',cash:'1110.00',receivables:'0.00',liabilities:'0.00'}]);
 });

 it('keeps a later reversal in its own period and restores the investing movement only once',()=>{
  const {data,source}=evidenceFixture();
  const report=personalFinancialReports(data,'2026-11-01',asOf,personalReportEvidence(data,source));
  expect(report.cashByActivity).toEqual([{currency:'SAR',activity:'INVESTING',inflows:'75.00',outflows:'0.00',net:'75.00'}]);
  expect(report.recognizedIncome.map(r=>[r.id,r.amount])).toEqual([['charge:reversal','-5.25']]);
 });

 it('keeps a funding amount mismatch out of investing and withholds an unreconciled historical component',()=>{
  const {data,source}=evidenceFixture();
  source.transactions[2].quantity=80;
  source.payables[0].request_id='different-request';
  data.accounts[0].baseBalance=999;
  const report=personalFinancialReports(data,'2026-10-01',cutoff,personalReportEvidence(data,source));
  expect(report.issues).toEqual(expect.arrayContaining(['PERSONAL_CASH_FUNDING_AMOUNT_MISMATCH','PERSONAL_INCOME_SOURCE_UNRECONCILED']));
  expect(report.cashByActivity).not.toContainEqual(expect.objectContaining({activity:'INVESTING'}));
  expect(report.historicalPosition[0].cash).toBeNull();
  expect(report.recognizedIncome).toHaveLength(1);
 });

 it('classifies only posted personal investment cash and recognizes receipts without treating principal as income',()=>{
  const {data,source}=evidenceFixture();
  for(const [id,kind,type,sign] of [['fund','FUND','TRANSFER_OUT',-1],['income','INCOME','ADD',1],
   ['redeem','REDEEM','TRANSFER_IN',1],['preview','INCOME','ADD',1],['mismatch','INCOME','ADD',1],['org','INCOME','ADD',1]] as const){
   const amount=kind==='INCOME'?10:100,day='2026-10-15';
   source.investments.push({id,contract_id:'investment-contract',organization_id:id==='org'?'organization':null,
    status:id==='preview'?'APPROVED':'POSTED',kind,account_id:'bank',operation_date:day,amount,exchange_rate:3.75});
   source.transactions.push({id,asset_account_id:'bank',transaction_type:type,transaction_date:day,currency:'USD',base_currency:'SAR',
    quantity:amount,gross_value:amount,base_value:amount*3.75,metadata:{source:'INVESTMENTS',investment_operation_id:id,
     investment_id:id==='mismatch'?'different-contract':'investment-contract',fx_rate:3.75}});
   data.cashMovements.push({id,accountId:'bank',date:day,amount:sign*amount*3.75,transactionType:type,currency:'SAR',
    source:'ASSETS',description:'Investment source',reference:id,internalTransferId:id});
  }
  const evidence=personalReportEvidence(data,source);
  expect(['fund','income','redeem'].map(id=>evidence.cash.get(id))).toEqual(['INVESTING','INVESTING','INVESTING']);
  expect(['preview','mismatch','org'].some(id=>evidence.cash.has(id))).toBe(false);
  expect(evidence.income.filter(row=>row.category==='INVESTMENT_INCOME')).toEqual([
   {id:'income',date:'2026-10-15',currency:'USD',amount:'10',category:'INVESTMENT_INCOME'},
  ]);
  expect(evidence.issues).toContain('PERSONAL_INVESTMENT_CASH_SOURCE_UNRECONCILED');
  const report=personalFinancialReports(data,'2026-10-01',cutoff,evidence);
  expect(report.cashTransferReconciliation[0].unverifiedLegs).toBe(3);
  expect(personalFinancialExportRows(report,'income',false)).toContainEqual(['2026-10-15','دخل استثمار','USD','10','income']);
 });

 it('uses a reconciled asset quantity and an explicit same-day quote for partial historical valuations',()=>{
  const {data,source}=evidenceFixture();
  const asset={id:'gold',name:'Gold fixture',asset_type:'GOLD',currency:'SAR',metadata:{market_price_per_unit:'412.50',
   market_price_source:'USER_MANUAL',market_valuation_date:cutoff,market_price_currency:'SAR'}};
  const statement={asOf:cutoff,complete:true,asset:{id:asset.id,organizational:false},closing:{quantity:'7',cost:'2470',currency:'SAR'}};
  const mark=personalHistoricalValuation(asset,statement,cutoff);
  expect(mark).toMatchObject({market:'2887.5',cost:'2470',date:cutoff});
  expect(personalHistoricalValuation({...asset,metadata:{...asset.metadata,market_valuation_date:asOf}},statement,cutoff)).toBeNull();
  expect(personalHistoricalValuation({...asset,metadata:{...asset.metadata,market_price_currency:'USD'}},statement,cutoff)).toBeNull();
  expect(personalHistoricalValuation(asset,{...statement,complete:false},cutoff)).toBeNull();
  expect(personalHistoricalValuation(asset,{...statement,asset:{...statement.asset,organizational:true}},cutoff)).toBeNull();
  const evidence=personalReportEvidence(data,source);
  const report=personalFinancialReports(data,'2026-10-01',cutoff,{...evidence,assetValuations:[mark!,{...mark!,date:asOf}]});
  expect(report.historicalAssetValuations).toEqual([mark]);
  expect(report.issues).toContain('PERSONAL_HISTORICAL_ASSET_VALUES_PARTIAL');
  expect(personalFinancialExportRows(report,'position',true)).toContainEqual(['Gold fixture','SAR','2470','2887.5','USER_MANUAL']);
 });
});
