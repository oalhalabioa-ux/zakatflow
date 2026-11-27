import {createElement} from 'react';
import * as React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {StatementReportTable} from '../components/financial-reports/SourceStatementTable';
import {personalStatementComparison, personalStatementCurrencies, personalStatementExport,
  personalStatementRows} from '../lib/personal-statement-presentation';
import type {PersonalReport} from '../lib/personal-financial-reports';

const documentId='00000000-0000-4000-8000-000000000001';
const transactionId='00000000-0000-4000-8000-000000000002';
const from='2026-03-01', to='2026-03-31';
const report:PersonalReport={
  scope:'PERSONAL',basis:'CURRENT_PERSONAL_REGISTER_ESTIMATE',asOf:'2026-04-02',from,to,baseCurrency:'SAR',
  categories:[],positions:[{currency:'SAR',cash:'999.00',receivables:'99.00',otherAssets:'0',investments:'0',
    liabilities:'0',netWorth:'1098.00',complete:true,unreconciled:0,unallocated:'0'}],
  cashAccounts:[{id:'one',name:'QA account',currency:'SAR',opening:'10',inflows:'25',outflows:'5',closing:'30',netMovement:'20',movementCount:2}],
  cashByActivity:[{currency:'SAR',activity:'OPERATING',inflows:'25',outflows:'0',net:'25'},
    {currency:'SAR',activity:'UNCLASSIFIED',inflows:'0',outflows:'5',net:'-5'}],
  cashTransferReconciliation:[],
  recognizedIncome:[{id:'one-investment',date:to,currency:'USD',amount:'12',category:'INVESTMENT_INCOME'}],
  historicalPosition:[{currency:'SAR',cash:'30',receivables:'80',liabilities:null,supplierAdvances:'0',customerAdvances:null}],
  historicalAssetValuations:[{id:'cutoff',name:'QA asset',date:to,currency:'SAR',market:'50',cost:'40',source:'USER_MANUAL'},
    {id:'late',name:'Newer valuation',date:'2026-04-01',currency:'SAR',market:'500',cost:'40',source:'USER_MANUAL'}],
  classifiedActivity:{basis:'EXPLICIT_PERSONAL_DOCUMENTS',coverage:'CLASSIFIED_SUBSET',from,to,totals:[],rows:[
    {document_id:documentId,transaction_id:transactionId,kind:'INCOME',category_code:'SERVICE',description:'QA',
      entry_date:to,amount:'25',currency:'SAR',base_amount:'25',base_currency:'SAR',is_reversal:false},
  ]},
  issues:[],
};

const prior:PersonalReport={...report,from:'2025-03-01',to:'2025-03-31',historicalAssetValuations:[],
  historicalPosition:[{...report.historicalPosition[0],cash:'20',liabilities:'7'}],
  classifiedActivity:{...report.classifiedActivity!,from:'2025-03-01',to:'2025-03-31',
    rows:[{...report.classifiedActivity!.rows[0],transaction_id:'00000000-0000-4000-8000-000000000003',
      base_amount:'20',entry_date:'2025-03-31'}]},
};

afterEach(()=>vi.unstubAllGlobals());

describe('personal registers on the shared statement layout',()=>{
  it('keeps currencies separate, groups comparable categories, and retains the original document',()=>{
    expect(personalStatementCurrencies(report,'income')).toEqual(['SAR','USD']);
    const sar=personalStatementRows(report,'income','SAR',true);
    expect(sar.find(row=>row.id==='net')?.value).toBe('25');
    expect(sar.find(row=>row.id==='EXPENSE')?.value).toBe('');
    expect(sar.find(row=>row.id==='document:'+transactionId)?.note).toContain(documentId);
    expect(personalStatementRows(report,'income','USD',true).find(row=>row.id==='net')?.value).toBe('12');
    const exported=personalStatementExport(report,'income',true,prior);
    expect(exported).toContainEqual(['SERVICE','','25','20','5.0000','25.0000']);
    expect(exported).toContainEqual(['Currency','USD']);
  });

  it('uses cutoff balances and valuations, including known prior values where the current balance is missing',()=>{
    const rows=personalStatementRows(report,'position','SAR',true);
    expect(rows.find(row=>row.id==='cash')?.value).toBe('30');
    expect(rows.find(row=>row.id==='assets')?.value).toBe('');
    expect(rows.find(row=>row.id==='net-worth')?.value).toBe('');
    expect(rows.find(row=>row.id==='valuation:cutoff')?.value).toBe('50');
    expect(rows.some(row=>row.id==='valuation:late'||row.value==='999.00')).toBe(false);
    const exported=personalStatementExport(report,'position',false,prior);
    expect(exported).toContainEqual(['النقد والبنوك','','30','20','10.0000','50.0000']);
    expect(exported).toContainEqual(['الذمم الدائنة','الرصيد غير مثبت بتاريخ القطع','','7','','']);
  });

  it('keeps unclassified cash separate and reconciles the net change and closing cash',()=>{
    const rows=personalStatementRows(report,'cash-flow','SAR',true);
    expect(rows.find(row=>row.id==='UNCLASSIFIED')?.value).toBe('-5');
    expect(rows.find(row=>row.id==='movement')?.value).toBe('20');
    expect(rows.find(row=>row.id==='closing')?.value).toBe('30');
    expect(rows.find(row=>row.id==='FINANCING')?.value).toBe('');
  });

  it('withholds exports without figures and rejects a comparison outside the corresponding period',()=>{
    expect(personalStatementComparison(report,{...prior,to:'2025-03-30'})).toBeNull();
    expect(()=>personalStatementExport({...report,recognizedIncome:[],classifiedActivity:undefined},'income',true,null))
      .toThrow('PERSONAL_EXPORT_DATA_REQUIRED');
  });

  it('keeps the landing overview export available for the figures shown on its cards',()=>{
    const rows=personalStatementRows(report,'overview','SAR',true);
    expect(rows.filter(row=>row.value).map(row=>row.id)).toEqual(['net','closing']);
    expect(personalStatementExport(report,'overview',true,prior)).toContainEqual(
      ['Net of verified items','Partial income and expense coverage','25','20','5.0000','25.0000']);
  });

  it.each([false,true])('renders the shared comparison table with the personal notes (English %s)',en=>{
    vi.stubGlobal('React',React);
    const html=renderToStaticMarkup(createElement(StatementReportTable,{
      rows:personalStatementRows(report,'position','SAR',en),previous:personalStatementRows(prior,'position','SAR',en),
      view:'position',caption:'QA',en,notes:true,delta:true,showKnownPrior:true,
    }));
    expect(html).toContain('fs-source-statement-table');
    expect(html).toContain(en?'Previous period':'الفترة السابقة');
    expect(html).toContain(en?'Balance unverified at the cutoff':'الرصيد غير مثبت بتاريخ القطع');
    expect(html).toContain('data-amount="30"');
    expect(html).toContain('50.00%');
    expect(html).not.toContain('data-amount="999.00"');
  });
});
