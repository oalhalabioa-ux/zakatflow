import {expect,it} from 'vitest';
import {projectClassifiedPersonalActivity} from '../lib/personal-source-contracts';
import {personalCutoffEvidence,reconcilePersonalClassification} from '../lib/personal-report-v2-sources';
import {personalFinancialReports} from '../lib/personal-financial-reports';
import {personalFinancialExportRows} from '../lib/personal-financial-export';
import type {RegisterData,CashMovement} from '../lib/financial-register';

const from='2026-03-01',cutoff='2026-03-31',later='2026-04-01';
const document='10000000-0000-4000-8000-000000000001',original='10000000-0000-4000-8000-000000000002',reverse='10000000-0000-4000-8000-000000000003';
it('reconciles a classified receipt once and allocates its reversal to the later period',()=>{
 const cash=(id:string,date:string,amount:number,transactionType:string):CashMovement=>({
  id,date,amount,transactionType,accountId:'cash',currency:'SAR',source:'ASSETS',description:'Fixture',reference:id,
 });
 const register:RegisterData={asOf:later,baseCurrency:'SAR',organizations:[],organizationIds:[],entities:[],assets:[],debts:[],debtMovements:[],warnings:[],
  accounts:[{id:'cash',name:'Cash',type:'BANK',currency:'SAR',baseCurrency:'SAR',nativeCurrency:'SAR',
   balance:28,baseBalance:28,restricted:0,uncleared:0,organizationId:null,entityId:null,source:'PERSONAL_ASSETS',openingDate:null}],
  cashMovements:[cash(original,'2026-03-05',25,'ADD'),cash('unclassified','2026-03-06',28,'ADD'),
   {...cash(reverse,later,-25,'REVERSAL'),reversalOfTransactionId:original}],
 };
 const row={document_id:document,transaction_id:original,kind:'INCOME',category_code:'SERVICE_INCOME',description:'Classified receipt',
  entry_date:'2026-03-05',amount:'25',currency:'SAR',base_amount:'25',base_currency:'SAR',is_reversal:false};
 const reversed={...row,transaction_id:reverse,entry_date:later,amount:'-25',base_amount:'-25',is_reversal:true};
 function report(to:string,rows:unknown[]){
  const evidence={cash:new Map(),income:[],issues:[]};
  const classifiedActivity=reconcilePersonalClassification(register,evidence,projectClassifiedPersonalActivity(rows),{from,to});
  return {...personalFinancialReports(register,from,to,evidence),classifiedActivity};
 }
 const earlier=report(cutoff,[row]);
 const full=report(later,[row,reversed]);
 expect(earlier.cashByActivity).toContainEqual({currency:'SAR',activity:'OPERATING',inflows:'25.00',outflows:'0.00',net:'25.00'});
 expect(earlier.cashByActivity).toContainEqual({currency:'SAR',activity:'UNCLASSIFIED',inflows:'28.00',outflows:'0.00',net:'28.00'});
 expect(full.classifiedActivity.totals[0].income).toBe('0');
 expect(personalFinancialExportRows(earlier,'income',true).filter(line=>line.includes(document))).toHaveLength(1);
 expect(personalFinancialExportRows(full,'income',true).filter(line=>line.includes(document))).toHaveLength(2);
 expect(report(cutoff,[{...row,base_amount:'26'}]).classifiedActivity.rows).toEqual([]);
});

it('keeps V2 cutoff debt evidence partial and never turns an explicit gap into zero',()=>{
 const result=personalCutoffEvidence({asOf:cutoff,scope:'PERSONAL',basis:'NATIVE_V2_MOVEMENTS',coverage:'PARTIAL',
  rows:[{id:document,source:'PERSONAL_PAYABLE',side:'PAYABLE',currency:'SAR',balance:'70',gap:null},
   {id:original,source:'PERSONAL_RECEIVABLE',side:'RECEIVABLE',currency:'USD',balance:null,gap:'SPECIALIZED_CONTRACT_SOURCE'}],
  excludedSources:['SPECIALIZED_CONTRACTS']},cutoff);
 expect(result.rows[0].balance).toBe('70');expect(result.rows[1].balance).toBeNull();
 const register:RegisterData={asOf:cutoff,baseCurrency:'SAR',organizations:[],organizationIds:[],entities:[],
  assets:[],debts:[],debtMovements:[],warnings:[],accounts:[],cashMovements:[]};
 const report={...personalFinancialReports(register,from,cutoff),cutoffSources:result};
 for(const english of [false,true]){
  const rows=personalFinancialExportRows(report,'position',english);
  expect(rows).toContainEqual(['PERSONAL_PAYABLE',document,'PAYABLE','SAR','70','']);
  expect(rows).toContainEqual(['PERSONAL_RECEIVABLE',original,'RECEIVABLE','USD','','SPECIALIZED_CONTRACT_SOURCE']);
 }
 expect(()=>personalCutoffEvidence({...result,rows:[{...result.rows[1],balance:'0'}]},cutoff)).toThrow('PERSONAL_CUTOFF_SOURCE_INVALID');
});
