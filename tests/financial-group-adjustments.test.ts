import {describe,expect,it} from 'vitest';
import {rollupAuthorizedTrialBalances,type RollupInput} from '../lib/financial-group-rollup';
import {previewGroupEliminations,type GroupElimination,type GroupEliminationLine} from '../lib/financial-group-adjustments';

const parent='10000000-0000-4000-8000-000000000001',subsidiary='10000000-0000-4000-8000-000000000002';
const parents=[{code:'1000',kind:'ASSET'},{code:'1100',kind:'ASSET'},{code:'2100',kind:'LIABILITY'},{code:'3100',kind:'EQUITY'},{code:'4000',kind:'REVENUE'},{code:'6000',kind:'OPEX'}] as const;
const request=():RollupInput=>({
 expectedOrganizationIds:[parent,subsidiary],from:'2026-01-01',to:'2026-12-31',currency:'SAR',parents:[...parents],
 members:[
  {organizationId:parent,from:'2026-01-01',to:'2026-12-31',currency:'SAR',details:[
   {accountId:'parent-bank',code:'100001',reportingCode:'1000',kind:'ASSET',debit:'50',credit:'0'},
   {accountId:'parent-ic-ar',code:'110001',reportingCode:'1100',kind:'ASSET',debit:'100',credit:'0'},
   {accountId:'parent-capital',code:'310001',reportingCode:'3100',kind:'EQUITY',debit:'0',credit:'150'},
  ]},
  {organizationId:subsidiary,from:'2026-01-01',to:'2026-12-31',currency:'SAR',details:[
   {accountId:'child-bank',code:'100002',reportingCode:'1000',kind:'ASSET',debit:'200',credit:'0'},
   {accountId:'child-ic-ap',code:'210002',reportingCode:'2100',kind:'LIABILITY',debit:'0',credit:'100'},
   {accountId:'child-equity',code:'310002',reportingCode:'3100',kind:'EQUITY',debit:'0',credit:'100'},
  ]},
 ],
});
const elimination=():GroupElimination&{lines:GroupEliminationLine[]}=>({
 id:'elim-ic-100',kind:'INTERCOMPANY_BALANCE',date:'2026-12-31',currency:'SAR',
 organizationIds:[parent,subsidiary],sourceReferences:['parent-invoice-01','child-bill-01'],reason:'Eliminate reciprocal intercompany AR and AP',
 lines:[
  {accountCode:'210001',reportingCode:'2100',debit:'100',credit:'0'},
  {accountCode:'110001',reportingCode:'1100',debit:'0',credit:'100'},
 ],
});

describe('group-only trial-balance adjustment staging',()=>{
 it('eliminates reciprocal AR/AP only in preview while preserving every source company and reconciliation',()=>{
  const source=rollupAuthorizedTrialBalances(request()),before=structuredClone(source),entry=elimination(),copy=structuredClone(entry);
  const result=previewGroupEliminations(source,parents,[entry]);
  expect(result.status).toBe('GROUP_ADJUSTMENT_PREVIEW_ONLY');
  expect(result).toMatchObject({beforeDebit:'350.0000',beforeCredit:'350.0000',adjustmentDebit:'100.0000',adjustmentCredit:'100.0000',afterDebit:'450.0000',afterCredit:'450.0000'});
  expect(result.rows.find(r=>r.reportingCode==='1100')).toMatchObject({beforeNetDebit:'100.0000',afterNetDebit:'0.0000'});
  expect(result.rows.find(r=>r.reportingCode==='2100')).toMatchObject({beforeNetDebit:'-100.0000',afterNetDebit:'0.0000'});
  expect(source).toEqual(before);
  expect(entry).toEqual(copy);
 });

 it('can stage reciprocal revenue/expense and balance eliminations from matching sources',()=>{
  const q=request();q.members[0].details.push({accountId:'parent-revenue',code:'400001',reportingCode:'4000',kind:'REVENUE',debit:'0',credit:'50'},{accountId:'parent-additional-ar',code:'110002',reportingCode:'1100',kind:'ASSET',debit:'50',credit:'0'});
  q.members[1].details.push({accountId:'child-cost',code:'600001',reportingCode:'6000',kind:'OPEX',debit:'50',credit:'0'},{accountId:'child-additional-ap',code:'210003',reportingCode:'2100',kind:'LIABILITY',debit:'0',credit:'50'});
  const source=rollupAuthorizedTrialBalances(q),balances=elimination();
  balances.lines[0]={...balances.lines[0],debit:'150'};balances.lines[1]={...balances.lines[1],credit:'150'};
  const income:GroupElimination={...elimination(),id:'elim-income-50',kind:'INTERCOMPANY_INCOME',lines:[{accountCode:'400001',reportingCode:'4000',debit:'50',credit:'0'},{accountCode:'600001',reportingCode:'6000',debit:'0',credit:'50'}]};
  const result=previewGroupEliminations(source,parents,[balances,income]);
  for(const code of['1100','2100','4000','6000'])expect(result.rows.find(r=>r.reportingCode===code)?.afterNetDebit).toBe('0.0000');
  expect(result.afterDebit).toBe(result.afterCredit);
 });

 it('rejects unbalanced eliminations and avoids silent automatic counteraccounts',()=>{
  const e=elimination();e.lines[0]={...e.lines[0],debit:'99'};
  expect(()=>previewGroupEliminations(rollupAuthorizedTrialBalances(request()),parents,[e])).toThrow('GROUP_ADJUSTMENT_UNBALANCED');
 });

 it('rejects eliminated journal duplicates and wrong group membership',()=>{
  const e=elimination(),source=rollupAuthorizedTrialBalances(request());
  expect(()=>previewGroupEliminations(source,parents,[e,e])).toThrow('GROUP_ADJUSTMENT_DUPLICATE');
  const wrong=elimination();wrong.organizationIds[1]='10000000-0000-4000-8000-000000000009';
  expect(()=>previewGroupEliminations(source,parents,[wrong])).toThrow('GROUP_ADJUSTMENT_MEMBERSHIP_INVALID');
 });

 it('does not double-eliminate the same source reference under two different journal IDs',()=>{
  const rollup=rollupAuthorizedTrialBalances(request());
  const first=elimination();
  const second={...elimination(),id:'second-adjustment',sourceReferences:['parent-invoice-01','child-bill-02']};
  expect(()=>previewGroupEliminations(rollup,parents,[first,second]))
   .toThrow('GROUP_ADJUSTMENT_DUPLICATE_EVIDENCE');
 });
 it('rejects FX assumptions, outside dates, unmapped children and missing source evidence',()=>{
  const s=rollupAuthorizedTrialBalances(request());
  const fx=elimination();fx.currency='USD';expect(()=>previewGroupEliminations(s,parents,[fx])).toThrow('GROUP_ADJUSTMENT_PERIOD_CURRENCY_MISMATCH');
  const date=elimination();date.date='2026-02-30';expect(()=>previewGroupEliminations(s,parents,[date])).toThrow('GROUP_ADJUSTMENT_PERIOD_CURRENCY_MISMATCH');
  const mapping=elimination();mapping.lines[0]={...mapping.lines[0],accountCode:'999901'};expect(()=>previewGroupEliminations(s,parents,[mapping])).toThrow('GROUP_ADJUSTMENT_MAPPING_INVALID');
  const evidence=elimination();evidence.sourceReferences=[];expect(()=>previewGroupEliminations(s,parents,[evidence])).toThrow('GROUP_ADJUSTMENT_EVIDENCE_REQUIRED');
 });

 it('rejects intercompany balances larger than reciprocal source receivables and payables',()=>{
  const entry=elimination(),source=rollupAuthorizedTrialBalances(request());
  entry.lines[0].debit='150';entry.lines[1].credit='150';
  expect(()=>previewGroupEliminations(source,parents,[entry])).toThrow('GROUP_ADJUSTMENT_EXCEEDS_SOURCE');
  const invalid=elimination();
  invalid.lines=[{accountCode:'210001',reportingCode:'2100',debit:'0',credit:'100'},
                 {accountCode:'110001',reportingCode:'1100',debit:'100',credit:'0'}];
  expect(()=>previewGroupEliminations(source,parents,[invalid])).toThrow('GROUP_ADJUSTMENT_PAIR_INVALID');
 });
 it('requires opposite companies to hold the reciprocal balances, not just a net group balance',()=>{
  const req=request();
  req.members[0].details.push({accountId:'parent-ic-ap',code:'210001',reportingCode:'2100',kind:'LIABILITY',debit:'0',credit:'100'});
  req.members[0].details[2].credit='50';
  req.members[1].details=req.members[1].details.filter(d=>d.accountId!=='child-ic-ap');
  req.members[1].details.find(d=>d.accountId==='child-equity')!.credit='200';
  const source=rollupAuthorizedTrialBalances(req);
  expect(()=>previewGroupEliminations(source,parents,[elimination()])).toThrow('GROUP_ADJUSTMENT_RECIPROCAL_MEMBERS_MISSING');
 });
 it('rejects an income elimination for which the matching expense is missing',()=>{
  const source=rollupAuthorizedTrialBalances(request());
  const entry={...elimination(),kind:'INTERCOMPANY_INCOME' as const,
   lines:[{accountCode:'400001',reportingCode:'4000',debit:'50',credit:'0'},
          {accountCode:'600001',reportingCode:'6000',debit:'0',credit:'50'}]};
  expect(()=>previewGroupEliminations(source,parents,[entry])).toThrow('GROUP_ADJUSTMENT_EXCEEDS_SOURCE');
 });
 it('fails closed when a pre-elimination source total or entity breakdown has been corrupted',()=>{
  const s=rollupAuthorizedTrialBalances(request());s.byParent[0].members[0].debit='999';
  expect(()=>previewGroupEliminations(s,parents,[elimination()])).toThrow('GROUP_ADJUSTMENT_SOURCE_INVALID');
 });
});
