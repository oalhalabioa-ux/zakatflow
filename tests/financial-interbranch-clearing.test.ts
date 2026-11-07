import {describe,expect,it} from 'vitest';
import {previewInterbranchClearings,type InterbranchClearingPair} from '../lib/financial-interbranch-clearing';
import {branchStatementSourceLines,type BranchStatementInput} from '../lib/financial-branch-statements';
import type {StatementSource} from '../lib/financial-statement-engine';

const org='10000000-0000-4000-8000-000000000001',branch='20000000-0000-4000-8000-000000000002';
function fixture():BranchStatementInput{
 const source:StatementSource={
  organizationId:org,currency:'SAR',openingDate:'2025-12-31',fiscalStart:'2026-01-01',
  from:'2026-01-01',to:'2026-12-31',
  accounts:[
   {id:'1000',organizationId:org,currency:'SAR',kind:'ASSET',cash:true},
   {id:'1200',organizationId:org,currency:'SAR',kind:'ASSET'},
   {id:'2200',organizationId:org,currency:'SAR',kind:'LIABILITY'},
   {id:'3100',organizationId:org,currency:'SAR',kind:'EQUITY'},
  ],
  opening:[{accountId:'1000',debit:'300',credit:'0'},{accountId:'3100',debit:'0',credit:'300'}],
  journals:[
   {id:'hq-payment',organizationId:org,currency:'SAR',date:'2026-02-01',status:'POSTED',lines:[
    {accountId:'1200',debit:'100',credit:'0'},
    {accountId:'1000',debit:'0',credit:'100',cashActivity:'FINANCING'},
   ]},
   {id:'branch-receipt',organizationId:org,currency:'SAR',date:'2026-02-01',status:'POSTED',lines:[
    {accountId:'1000',debit:'100',credit:'0',cashActivity:'FINANCING'},
    {accountId:'2200',debit:'0',credit:'100'},
   ]},
  ],
 };
 const allocations=branchStatementSourceLines(source).map(r=>({...r,allocations:[{
  branchId:r.sourceKind==='OPENING'||r.sourceId.includes('hq-payment')?null:branch,
  debit:r.debit,credit:r.credit,
 }]}));
 return{source,branchIds:[branch],allocations,
  coverage:{complete:true,scope:'ORGANIZATION_ALL_ENTITIES',revision:'trusted-read-revision-1',sourceCount:allocations.length}};
}
const pair:InterbranchClearingPair={
 id:'cash-transfer-1',fromBranchId:null,toBranchId:branch,
 dueFromAccountId:'1200',dueToAccountId:'2200',amount:'100',
 sourceReferences:['hq-payment','branch-receipt'],
};
describe('QA-only reciprocal interbranch balance elimination',()=>{
 it('eliminates matched due-from / due-to in preview without changing cash, income, or the posted source',()=>{
  const input=fixture(),prior=JSON.stringify(input);
  const result=previewInterbranchClearings(input,[pair]);
  expect(result).toMatchObject({
   status:'INTERBRANCH_CLEARING_PREVIEW_ONLY',
   before:{assets:'400.0000',liabilities:'100.0000',equity:'300.0000'},
   after:{assets:'300.0000',liabilities:'0.0000',equity:'300.0000'},
   openingCash:'300.0000',closingCash:'300.0000',netProfit:'0.0000',
   sourceReferencesVerified:false,companyStatementCertified:false,
  });
  expect(JSON.stringify(input)).toBe(prior);
 });
 it('does not infer an elimination without explicit documentary pairing',()=>{
  expect(previewInterbranchClearings(fixture(),[])).toMatchObject({status:'BLOCKED',code:'CLEARING_EVIDENCE_INVALID'});
 });
 it('refuses missing, reused or foreign reciprocal evidence',()=>{
  const input=fixture();
  expect(previewInterbranchClearings(input,[{...pair,amount:'99'}])).toMatchObject({status:'BLOCKED',code:'CLEARING_MISMATCH'});
  expect(previewInterbranchClearings(input,[{...pair,toBranchId:'foreign'}])).toMatchObject({status:'BLOCKED',code:'CLEARING_EVIDENCE_INVALID'});
  expect(previewInterbranchClearings(input,[pair,pair])).toMatchObject({status:'BLOCKED',code:'CLEARING_EVIDENCE_INVALID'});
  expect(previewInterbranchClearings(input,[{...pair,sourceReferences:['same','same']}])).toMatchObject({status:'BLOCKED',code:'CLEARING_EVIDENCE_INVALID'});
 });
 it('refuses unbalanced/missing posted journals before offering even a preview',()=>{
  const input=fixture();input.source.journals.pop();
  input.allocations=branchStatementSourceLines(input.source).map(r=>({...r,allocations:[{
   branchId:r.sourceKind==='OPENING'||r.sourceId.includes('hq-payment')?null:branch,
   debit:r.debit,credit:r.credit,
  }]}));
  input.coverage.sourceCount=input.allocations.length;
  expect(previewInterbranchClearings(input,[pair])).toMatchObject({status:'BLOCKED',code:'CLEARING_MISMATCH'});
  const corrupt=fixture();
  corrupt.source.journals[1].lines.pop();
  corrupt.allocations=branchStatementSourceLines(corrupt.source).map(r=>({...r,allocations:[{
   branchId:r.sourceKind==='OPENING'||r.sourceId.includes('hq-payment')?null:branch,
   debit:r.debit,credit:r.credit,
  }]}));
  corrupt.coverage.sourceCount=corrupt.allocations.length;
  expect(previewInterbranchClearings(corrupt,[pair])).toMatchObject({status:'BLOCKED',code:'SEGMENTS_UNRECONCILED'});
 });
});
