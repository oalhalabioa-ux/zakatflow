import {describe,it,expect} from 'vitest';
import {personalFinancialExportRows} from '../lib/personal-financial-export';
import {financialSourceRowsCsv} from '../lib/financial-budget-source';
import type {PersonalReport} from '../lib/personal-financial-reports';

const base:PersonalReport={
 scope:'PERSONAL',basis:'CURRENT_PERSONAL_REGISTER_ESTIMATE',asOf:'2026-11-06',from:'2026-01-01',to:'2026-11-06',baseCurrency:'SAR',
 categories:[{id:'CASH',code:'1000',ar:'النقد والبنوك',en:'Cash and banks',currency:'SAR',amount:'500.00',kind:'ASSET'}],
 positions:[
  {currency:'SAR',cash:'500.00',receivables:'200.00',investments:'0.00',otherAssets:'100.00',liabilities:'50.00',netWorth:'750.00',complete:true,unreconciled:0,unallocated:'0.00'},
  {currency:'USD',cash:'100.00',receivables:'0.00',investments:'0.00',otherAssets:'0.00',liabilities:'0.00',netWorth:null,complete:false,unreconciled:1,unallocated:'0.00'},
 ],
 cashAccounts:[{id:'cash-a',name:'=HYPERLINK("https://unsafe.example")',currency:'SAR',opening:'400.00',inflows:'250.00',outflows:'150.00',netMovement:'100.00',closing:'500.00',movementCount:3}],
 cashTransferReconciliation:[{currency:'SAR',grossInflows:'250.00',grossOutflows:'150.00',verifiedInternalInflows:'100.00',verifiedInternalOutflows:'100.00',remainingUnclassifiedInflows:'150.00',remainingUnclassifiedOutflows:'50.00',verifiedPairs:1,unverifiedLegs:0,transferEvidenceComplete:true}],
 cashByActivity:[],recognizedIncome:[],historicalPosition:[],
 issues:['PERSONAL_POSITION_RECONCILIATION_REQUIRED','PERSONAL_CASH_GROSS_INCLUDES_INTERNAL_TRANSFERS'],
};

describe('personal estimate exports',()=>{
 it('exports both separate currencies and withholds unreconciled net worth',()=>{const rows=personalFinancialExportRows(base,'position',true);expect(rows).toContainEqual(['Scope','Personal only']);expect(rows).toContainEqual(['Report status','Estimate — not audited']);expect(rows.some(row=>row[0]==='SAR'&&row[6]==='750.00')).toBe(true);expect(rows.some(row=>row[0]==='USD'&&row[6]===''&&row[7].startsWith('Incomplete'))).toBe(true);expect(rows.some(row=>row[0]==='Income'&&row[1])).toBe(false)});
 it('exports gross cash movement with clear qualification and formula-safe CSV',()=>{const rows=personalFinancialExportRows(base,'cash',false);expect(rows.flat().some(cell=>cell.includes('ليست قائمة تدفقات نقدية معيارية'))).toBe(true);const csv=financialSourceRowsCsv(rows);expect(csv).toContain('"\'=HYPERLINK(');expect(csv).toContain('"400.00"');expect(csv).toContain('"100.00"')});
 it('exports only explicitly verified internal transfer pairs without inventing external flow types',()=>{const rows=personalFinancialExportRows(base,'cash',true);expect(rows).toContainEqual(['SAR','100.00','100.00','150.00','50.00','1','0']);expect(rows.flat().join(' ')).not.toMatch(/operating cash flow|revenue|net profit/i)});
 it('does not allow wrong source, unsupported views or fabricated income',()=>{expect(()=>personalFinancialExportRows({...base,scope:'ORGANIZATION'} as unknown as PersonalReport,'position',true)).toThrow('PERSONAL_EXPORT_SCOPE_INVALID');expect(()=>personalFinancialExportRows(base,'income',true)).toThrow('PERSONAL_EXPORT_INCOME_EVIDENCE_REQUIRED');expect(()=>personalFinancialExportRows(base,'unknown' as never,true)).toThrow('PERSONAL_EXPORT_VIEW_INVALID')});
 it('generates the same codes and labels in both language variants',()=>{const ar=personalFinancialExportRows(base,'accounts',false),en=personalFinancialExportRows(base,'accounts',true);expect(ar.find(row=>row[0]==='1000')?.[1]).toBe('النقد والبنوك');expect(en.find(row=>row[0]==='1000')?.[1]).toBe('Cash and banks')});
});

describe('reports without exportable rows',()=>{
 const empty={...base,positions:[],cashAccounts:[],cashTransferReconciliation:[],categories:[]};
 it.each(['overview','position','cash','accounts'] as const)('rejects a %s export that would contain metadata and headings only',view=>{
  expect(()=>personalFinancialExportRows(empty,view,false)).toThrow('PERSONAL_EXPORT_DATA_REQUIRED');
 });
 it('keeps exports available for an authorized historical balance without current accounts',()=>{
  const historical={...empty,historicalPosition:[{currency:'SAR',cash:null,receivables:'80.00',liabilities:null,supplierAdvances:null,customerAdvances:null}]};
  expect(personalFinancialExportRows(historical,'position',true)).toContainEqual(['SAR','','80.00','','','']);
 });
});
