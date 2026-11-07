import {describe,expect,it} from 'vitest';
import {branchStatementSourceLines,compileBranchStatementPreview,type BranchStatementInput} from '../lib/financial-branch-statements';
import type {StatementSource} from '../lib/financial-statement-engine';
import type {BranchSourceLine} from '../lib/financial-branch-allocation';

const org='10000000-0000-4000-8000-000000000001',branch='branch-one';
function makeSource():StatementSource{
 return{
  organizationId:org,currency:'SAR',openingDate:'2025-12-31',fiscalStart:'2026-01-01',from:'2026-01-01',to:'2026-11-06',
  accounts:[
   {id:'1000',organizationId:org,currency:'SAR',kind:'ASSET',cash:true},
   {id:'3100',organizationId:org,currency:'SAR',kind:'EQUITY'},
   {id:'4000',organizationId:org,currency:'SAR',kind:'REVENUE'},
  ],
  opening:[{accountId:'1000',debit:'300.0000',credit:'0.0000'},{accountId:'3100',debit:'0.0000',credit:'300.0000'}],
  journals:[
   {id:'hq-income',date:'2026-03-01',status:'POSTED',organizationId:org,currency:'SAR',lines:[
    {accountId:'1000',debit:'20.0000',credit:'0.0000',cashActivity:'OPERATING'},
    {accountId:'4000',debit:'0.0000',credit:'20.0000'},
   ]},
   {id:'branch-income',date:'2026-04-01',status:'POSTED',organizationId:org,currency:'SAR',lines:[
    {accountId:'1000',debit:'50.0000',credit:'0.0000',cashActivity:'OPERATING'},
    {accountId:'4000',debit:'0.0000',credit:'50.0000'},
   ]},
  ],
 };
}
function data():BranchStatementInput{
 const source=makeSource();
 const allocations:BranchSourceLine[]=branchStatementSourceLines(source).map(row=>{
  const head=row.sourceKind==='OPENING'?row.accountCode==='1000'||row.accountCode==='3100':row.sourceId.includes('hq-income');
  if(row.sourceKind==='OPENING'){
   return{...row,allocations:[
    {branchId:null,debit:row.debit==='0.0000'?'0.0000':'100.0000',credit:row.credit==='0.0000'?'0.0000':'100.0000'},
    {branchId:branch,debit:row.debit==='0.0000'?'0.0000':'200.0000',credit:row.credit==='0.0000'?'0.0000':'200.0000'},
   ]};
  }
  return{...row,allocations:[{branchId:head?null:branch,debit:row.debit,credit:row.credit}]};
 });
 return{source,branchIds:[branch],coverage:{complete:true,scope:'ORGANIZATION_ALL_ENTITIES',sourceCount:allocations.length,revision:'server-ledger-and-opening-revision-1'},allocations};
}
describe('reconciled branch statement preview',()=>{
 it('issues balanced headquarters, branch and company control previews without changing posted sources',()=>{
  const input=data(),prior=JSON.stringify(input);
  const result=compileBranchStatementPreview(input);
  expect(result.status).toBe('RECONCILED_SEGMENTS_PREVIEW_ONLY');
  expect(result.issues).toEqual([]);
  expect(result.company?.position).toMatchObject({assets:'370.0000',equity:'370.0000'});
  expect(result.company?.income.netProfit).toBe('70.0000');
  expect(result.company?.cash).toMatchObject({opening:'300.0000',movement:'70.0000',closing:'370.0000'});
  expect(result.segments.find(s=>s.branchId===null)?.statement).toMatchObject({
   position:{assets:'120.0000',equity:'120.0000'},income:{netProfit:'20.0000'},cash:{opening:'100.0000',closing:'120.0000'},
  });
  expect(result.segments.find(s=>s.branchId===branch)?.statement).toMatchObject({
   position:{assets:'250.0000',equity:'250.0000'},income:{netProfit:'50.0000'},cash:{opening:'200.0000',closing:'250.0000'},
  });
  expect(JSON.stringify(input)).toBe(prior);
 });
 it('rejects a missing approved opening allocation; no branch figures are returned',()=>{
  const input=data();input.allocations[0].allocations=[];
  const result=compileBranchStatementPreview(input);
  expect(result).toMatchObject({status:'BLOCKED',company:null,segments:[]});
  expect(result.issues).toContainEqual({code:'MISSING_ALLOCATION',sourceId:'OPEN:1000'});
 });
 it('refuses unbalanced opening distributions even if the whole legal company is balanced',()=>{
  const input=data();input.allocations[0].allocations=[{branchId:null,debit:'150.0000',credit:'0.0000'},{branchId:branch,debit:'150.0000',credit:'0.0000'}];
  expect(compileBranchStatementPreview(input)).toMatchObject({status:'BLOCKED',segments:[]});
 });
 it('rejects a branch journal with a debit in one segment and credit in another',()=>{
  const input=data();
  const credit=input.allocations.find(r=>r.sourceId==='J:branch-income:1')!;
  credit.allocations=[{branchId:null,debit:'0.0000',credit:'50.0000'}];
  const result=compileBranchStatementPreview(input);
  expect(result).toMatchObject({status:'BLOCKED',company:null,segments:[]});
  expect(result.issues.some(i=>i.code==='BRANCH_MOVEMENT_NOT_BALANCED')).toBe(true);
 });
 it('rejects duplicate, missing, altered or stale source-line attestations',()=>{
  const x=data();x.allocations=x.allocations.slice(0,-1);
  expect(()=>compileBranchStatementPreview(x)).toThrow('BRANCH_STATEMENT_SOURCE_INCOMPLETE');
  const y=data();y.allocations[0].accountCode='9999';
  expect(()=>compileBranchStatementPreview(y)).toThrow('BRANCH_STATEMENT_SOURCE_MISMATCH');
  const z=data();z.coverage.sourceCount=0;
  expect(()=>compileBranchStatementPreview(z)).toThrow('BRANCH_STATEMENT_SOURCE_INCOMPLETE');
  const d=data();d.allocations=[...d.allocations.slice(0,1),{...d.allocations[0]},...d.allocations.slice(2)];
  expect(()=>compileBranchStatementPreview(d)).toThrow('BRANCH_STATEMENT_DUPLICATE_ALLOCATION');
 });
 it('supports a company without branches, including capital received during the financial year without opening',()=>{
  const input=data();input.branchIds=[];
  input.source.opening=[];
  input.source.journals=[{
   id:'capital-receipt',organizationId:org,currency:'SAR',date:'2026-01-02',status:'POSTED',
   lines:[{accountId:'1000',debit:'100.0000',credit:'0.0000',cashActivity:'FINANCING'},
    {accountId:'3100',debit:'0.0000',credit:'100.0000'}],
  }];
  input.allocations=branchStatementSourceLines(input.source).map(r=>({...r,allocations:[{branchId:null,debit:r.debit,credit:r.credit}]}));
  input.coverage.sourceCount=input.allocations.length;
  const result=compileBranchStatementPreview(input);
  expect(result).toMatchObject({status:'RECONCILED_SEGMENTS_PREVIEW_ONLY',segments:[{branchId:null,statement:{position:{assets:'100.0000',equity:'100.0000'}}}]});
 });
 it('supports a newly opened branch with zero opening balance and genuine current-year movements',()=>{
  const input=data();
  // The legal company has historical opening capital, but the newly established
  // branch has none. All opening lines belong to headquarters.
  input.allocations=input.allocations.map(row=>row.sourceKind==='OPENING'
   ? {...row,allocations:[{branchId:null,debit:row.debit,credit:row.credit}]}
   : row);
  const result=compileBranchStatementPreview(input);
  expect(result.status).toBe('RECONCILED_SEGMENTS_PREVIEW_ONLY');
  expect(result.segments.find(s=>s.branchId===branch)?.statement).toMatchObject({
   cash:{opening:'0.0000',movement:'50.0000',closing:'50.0000'},
   income:{netProfit:'50.0000'},
   position:{assets:'50.0000',equity:'50.0000'},
  });
  expect(result.company?.cash.opening).toBe('300.0000');
 });
 it('keeps a newly created dormant branch at zero without requiring an opening workspace',()=>{
  const input=data();
  input.source.opening=[];
  input.source.journals=[];
  input.allocations=[];
  input.coverage.sourceCount=0;
  const result=compileBranchStatementPreview(input);
  expect(result.status).toBe('RECONCILED_SEGMENTS_PREVIEW_ONLY');
  expect(result.segments.find(s=>s.branchId===branch)?.statement.cash).toMatchObject({
   opening:'0.0000',movement:'0.0000',closing:'0.0000',
  });
 });

 it('records new legal capital as a current-year equity receipt rather than income',()=>{
  const input=data();
  input.source.opening=[];
  input.source.journals=[{
   id:'fund-new-branch',organizationId:org,currency:'SAR',date:'2026-02-01',status:'POSTED',
   lines:[
    {accountId:'1000',debit:'100.0000',credit:'0.0000',cashActivity:'FINANCING'},
    {accountId:'3100',debit:'0.0000',credit:'100.0000'},
   ],
  }];
  input.allocations=branchStatementSourceLines(input.source).map(row=>({
   ...row,allocations:[{branchId:branch,debit:row.debit,credit:row.credit}],
  }));
  input.coverage.sourceCount=input.allocations.length;
  const result=compileBranchStatementPreview(input);
  expect(result.status).toBe('RECONCILED_SEGMENTS_PREVIEW_ONLY');
  expect(result.segments.find(s=>s.branchId===branch)?.statement).toMatchObject({
   cash:{opening:'0.0000',closing:'100.0000'},
   income:{netProfit:'0.0000'},
   position:{assets:'100.0000',equity:'100.0000'},
  });
 });

 it('records a genuine headquarters-to-new-branch cash transfer using two balanced clearing journals',()=>{
  const input=data();
  input.source.accounts.push(
   {id:'1200',organizationId:org,currency:'SAR',kind:'ASSET'},
   {id:'2200',organizationId:org,currency:'SAR',kind:'LIABILITY'},
  );
  // These are movements inside ONE legal company, not equity subscriptions.
  // The transfer requires matching HQ receivable and branch payable clearing,
  // with no revenue or capital contribution to the branch.
  input.source.journals=[
   {id:'hq-transfer-out',organizationId:org,currency:'SAR',date:'2026-02-01',status:'POSTED',lines:[
    {accountId:'1200',debit:'100.0000',credit:'0.0000'},
    {accountId:'1000',debit:'0.0000',credit:'100.0000',cashActivity:'FINANCING'},
   ]},
   {id:'branch-transfer-in',organizationId:org,currency:'SAR',date:'2026-02-01',status:'POSTED',lines:[
    {accountId:'1000',debit:'100.0000',credit:'0.0000',cashActivity:'FINANCING'},
    {accountId:'2200',debit:'0.0000',credit:'100.0000'},
   ]},
  ];
  // The new branch has zero opening. Existing company capital is HQ opening.
  input.allocations=branchStatementSourceLines(input.source).map(row=>({
   ...row,allocations:[{
    branchId:row.sourceKind==='OPENING'||row.sourceId.includes('hq-transfer-out')?null:branch,
    debit:row.debit,credit:row.credit,
   }],
  }));
  input.coverage.sourceCount=input.allocations.length;
  const result=compileBranchStatementPreview(input);
  expect(result.status).toBe('RECONCILED_SEGMENTS_PREVIEW_ONLY');
  expect(result.company).toMatchObject({
   income:{revenue:'0.0000',netProfit:'0.0000'},
   cash:{opening:'300.0000',movement:'0.0000',closing:'300.0000'},
   // These pre-elimination gross amounts are only a preview: due-from/due-to
   // still need company-level elimination before any published statement.
   position:{assets:'400.0000',liabilities:'100.0000',equity:'300.0000'},
  });
  expect(result.segments.find(s=>s.branchId===null)?.statement).toMatchObject({
   cash:{opening:'300.0000',financing:'-100.0000',closing:'200.0000'},
   income:{netProfit:'0.0000'},
   position:{assets:'300.0000',liabilities:'0.0000',equity:'300.0000'},
  });
  expect(result.segments.find(s=>s.branchId===branch)?.statement).toMatchObject({
   cash:{opening:'0.0000',financing:'100.0000',closing:'100.0000'},
   income:{revenue:'0.0000',netProfit:'0.0000'},
   position:{assets:'100.0000',liabilities:'100.0000',equity:'0.0000'},
  });
 });

 it('blocks a one-sided branch transfer rather than inventing an opening balance or revenue',()=>{
  const input=data();
  input.source.opening=[];
  input.source.journals=[{
   id:'unmatched-transfer',organizationId:org,currency:'SAR',date:'2026-02-01',status:'POSTED',
   lines:[{accountId:'1000',debit:'100.0000',credit:'0.0000',cashActivity:'FINANCING'}],
  }];
  input.allocations=branchStatementSourceLines(input.source).map(row=>({
   ...row,allocations:[{branchId:branch,debit:row.debit,credit:row.credit}],
  }));
  input.coverage.sourceCount=input.allocations.length;
  expect(()=>compileBranchStatementPreview(input)).toThrow('JOURNAL_UNBALANCED');
 });

});
