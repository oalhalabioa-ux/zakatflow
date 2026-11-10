import {describe,expect,it} from 'vitest';
import {validateBranchAllocations,type BranchAllocationInput,type BranchSourceLine} from '../lib/financial-branch-allocation';

const a='branch-a',b='branch-b';
type MutableBranchLine=Omit<BranchSourceLine,'allocations'>&{allocations:{branchId:string|null;debit:string;credit:string}[]};
const data=():Omit<BranchAllocationInput,'sourceLines'>&{sourceLines:MutableBranchLine[]}=>({
 organizationId:'10000000-0000-4000-8000-000000000001',currency:'SAR',branchIds:[a,b],
 coverage:{complete:true,scope:'ORGANIZATION_ALL_ENTITIES',sourceCount:6,revision:'trusted-opening-and-event-revision-1'},
 sourceLines:[
  {sourceId:'opening-bank',sourceKind:'OPENING',accountCode:'100001',debit:'120',credit:'0',allocations:[{branchId:a,debit:'50',credit:'0'},{branchId:b,debit:'70',credit:'0'}]},
  {sourceId:'opening-capital',sourceKind:'OPENING',accountCode:'310001',debit:'0',credit:'120',allocations:[{branchId:a,debit:'0',credit:'50'},{branchId:b,debit:'0',credit:'70'}]},
  {sourceId:'sale-a-cash',sourceKind:'JOURNAL',accountCode:'100001',debit:'100',credit:'0',allocations:[{branchId:a,debit:'100',credit:'0'}]},
  {sourceId:'sale-a-revenue',sourceKind:'JOURNAL',accountCode:'400001',debit:'0',credit:'100',allocations:[{branchId:a,debit:'0',credit:'100'}]},
  {sourceId:'sale-b-cash',sourceKind:'JOURNAL',accountCode:'100001',debit:'200',credit:'0',allocations:[{branchId:b,debit:'200',credit:'0'}]},
  {sourceId:'sale-b-revenue',sourceKind:'JOURNAL',accountCode:'400001',debit:'0',credit:'200',allocations:[{branchId:b,debit:'0',credit:'200'}]},
 ],
});

describe('branch allocation completeness preflight',()=>{
 it('includes opening balances and source journals exactly once for both branches',()=>{
  const r=validateBranchAllocations(data());
  expect(r).toMatchObject({status:'READY_FOR_BRANCH_REPORTS',sourceCount:6,issues:[]});
  expect(r.branchTrialBalances.find(x=>x.branchId===a)).toMatchObject({totalDebit:'150.0000',totalCredit:'150.0000'});
  expect(r.branchTrialBalances.find(x=>x.branchId===b)).toMatchObject({totalDebit:'270.0000',totalCredit:'270.0000'});
  expect(r.branchTrialBalances.reduce((total,x)=>total+Number(x.totalDebit),0)).toBe(420);
  expect(r.companyReconciliation).toMatchObject({totalDebit:'420.0000',totalCredit:'420.0000'});
  expect(r.companyReconciliation?.accounts.find(row=>row.accountCode==='100001'))
   .toMatchObject({debit:'420.0000',credit:'0.0000'});
 });

 it('never invents an allocation for approved opening amounts',()=>{
  const d=data();d.sourceLines[0].allocations=[];
  const r=validateBranchAllocations(d);
  expect(r.status).toBe('BLOCKED');
  expect(r.issues).toContainEqual({code:'MISSING_ALLOCATION',sourceId:'opening-bank'});
  expect(r.branchTrialBalances).toEqual([]);
  expect(r.companyReconciliation).toBeNull();
 });

 it('rejects short allocation totals without presenting partial branch financials',()=>{
  const d=data();d.sourceLines[1].allocations=[{branchId:a,debit:'0',credit:'50'},{branchId:b,debit:'0',credit:'60'}];
  const r=validateBranchAllocations(d);
  expect(r.status).toBe('BLOCKED');
  expect(r.issues.some(i=>i.code==='ALLOCATION_MISMATCH')).toBe(true);
  expect(r.branchTrialBalances).toEqual([]);
  expect(r.companyReconciliation).toBeNull();
 });

 it('blocks internal branch movements until branch clearing accounts reconcile',()=>{
  const d=data();d.sourceLines.push(
   {sourceId:'internal-in',sourceKind:'JOURNAL',accountCode:'100001',debit:'100',credit:'0',allocations:[{branchId:a,debit:'100',credit:'0'}]},
   {sourceId:'internal-out',sourceKind:'JOURNAL',accountCode:'100001',debit:'0',credit:'100',allocations:[{branchId:b,debit:'0',credit:'100'}]},
  );
  d.coverage.sourceCount=d.sourceLines.length;
  const r=validateBranchAllocations(d);
  expect(r.status).toBe('BLOCKED');
  expect(r.issues.filter(i=>i.code==='BRANCH_NOT_BALANCED')).toHaveLength(2);
 });

 it('fails closed on duplicate source lines and unknown branch references',()=>{
  const d=data();d.sourceLines.push({...d.sourceLines[0]});
  d.coverage.sourceCount=d.sourceLines.length;
  expect(()=>validateBranchAllocations(d)).toThrow('BRANCH_ALLOCATION_SOURCE_INVALID');
  const other=data();other.sourceLines[0].allocations=[{branchId:'outside-tenant',debit:'120',credit:'0'}];
  expect(()=>validateBranchAllocations(other)).toThrow('BRANCH_ALLOCATION_BRANCH_INVALID');
 });

 it('supports new organizations without opening balances when capital enters as a real journal',()=>{
  const d=data();d.sourceLines=[
   {sourceId:'capital-cash',sourceKind:'JOURNAL',accountCode:'100001',debit:'100',credit:'0',allocations:[{branchId:a,debit:'100',credit:'0'}]},
   {sourceId:'capital-equity',sourceKind:'JOURNAL',accountCode:'310001',debit:'0',credit:'100',allocations:[{branchId:a,debit:'0',credit:'100'}]},
  ];
  d.coverage.sourceCount=d.sourceLines.length;
  const r=validateBranchAllocations(d);
  expect(r.status).toBe('READY_FOR_BRANCH_REPORTS');
  expect(r.branchTrialBalances.find(x=>x.branchId===b)?.totalDebit).toBe('0.0000');
 });

 it('supports company-headquarters journals without inventing a branch',()=>{
  const d=data();d.branchIds=[];d.sourceLines=[
   {sourceId:'hq-bank',sourceKind:'JOURNAL',accountCode:'100001',debit:'300',credit:'0',allocations:[{branchId:null,debit:'300',credit:'0'}]},
   {sourceId:'hq-capital',sourceKind:'JOURNAL',accountCode:'310001',debit:'0',credit:'300',allocations:[{branchId:null,debit:'0',credit:'300'}]},
  ];d.coverage.sourceCount=2;
  const result=validateBranchAllocations(d);
  expect(result).toMatchObject({status:'READY_FOR_BRANCH_REPORTS',issues:[],branchTrialBalances:[{branchId:null,scope:'ORGANIZATION_DIRECT',totalDebit:'300.0000',totalCredit:'300.0000'}]});
 });

 it('reconciles headquarters and branch segments together without allocating headquarters activity twice',()=>{
  const d=data();d.sourceLines.push(
   {sourceId:'hq-opening-bank',sourceKind:'OPENING',accountCode:'100001',debit:'200',credit:'0',allocations:[{branchId:null,debit:'200',credit:'0'}]},
   {sourceId:'hq-opening-capital',sourceKind:'OPENING',accountCode:'310001',debit:'0',credit:'200',allocations:[{branchId:null,debit:'0',credit:'200'}]},
  );d.coverage.sourceCount=d.sourceLines.length;
  const result=validateBranchAllocations(d);
  expect(result.status).toBe('READY_FOR_BRANCH_REPORTS');
  expect(result.branchTrialBalances.find(x=>x.scope==='ORGANIZATION_DIRECT')).toMatchObject({branchId:null,totalDebit:'200.0000',totalCredit:'200.0000'});
  expect(result.branchTrialBalances.filter(x=>x.scope==='BRANCH')).toHaveLength(2);
  expect(result.branchTrialBalances.reduce((sum,x)=>sum+Number(x.totalDebit),0)).toBe(620);
  expect(result.companyReconciliation?.totalDebit).toBe('620.0000');
  expect(result.companyReconciliation?.accounts).toContainEqual({accountCode:'100001',debit:'620.0000',credit:'0.0000',netDebit:'620.0000'});
 });

 it('never silently assigns missing or unbalanced headquarters entries',()=>{
  const d=data();d.sourceLines[0].allocations=[];
  expect(validateBranchAllocations(d).status).toBe('BLOCKED');
  const x=data();x.sourceLines[0].allocations=[{branchId:null,debit:'120',credit:'0'}];
  expect(validateBranchAllocations(x).status).toBe('BLOCKED');
  expect(validateBranchAllocations(x).issues).toContainEqual({code:'BRANCH_NOT_BALANCED',branchId:null});
 });

 it('requires an explicit complete authoritative source attestation, not a merely balanced subset',()=>{
  const d=data();d.coverage.sourceCount=3;
  expect(()=>validateBranchAllocations(d)).toThrow('BRANCH_ALLOCATION_SOURCE_INCOMPLETE');
  const unsafe=data();unsafe.coverage.complete=false as true;
  expect(()=>validateBranchAllocations(unsafe)).toThrow('BRANCH_ALLOCATION_SOURCE_INCOMPLETE');
 });

 it('blocks a deceptively balanced branch when an unbalanced opening is offset by journal movements',()=>{
  const d=data();d.sourceLines=[
   {sourceId:'opening-cash-A',sourceKind:'OPENING',accountCode:'100001',debit:'100',credit:'0',
    allocations:[{branchId:a,debit:'100',credit:'0'}]},
   {sourceId:'opening-equity-B',sourceKind:'OPENING',accountCode:'310001',debit:'0',credit:'100',
    allocations:[{branchId:b,debit:'0',credit:'100'}]},
   {sourceId:'journal-cash-B',sourceKind:'JOURNAL',accountCode:'100001',debit:'100',credit:'0',
    allocations:[{branchId:b,debit:'100',credit:'0'}]},
   {sourceId:'journal-revenue-A',sourceKind:'JOURNAL',accountCode:'400001',debit:'0',credit:'100',
    allocations:[{branchId:a,debit:'0',credit:'100'}]},
  ];d.coverage.sourceCount=d.sourceLines.length;
  const result=validateBranchAllocations(d);
  expect(result.status).toBe('BLOCKED');
  expect(result.issues).toContainEqual({code:'BRANCH_OPENING_NOT_BALANCED',branchId:a});
  expect(result.issues).toContainEqual({code:'BRANCH_MOVEMENT_NOT_BALANCED',branchId:a});
  expect(result.issues).toContainEqual({code:'BRANCH_OPENING_NOT_BALANCED',branchId:b});
  expect(result.issues).toContainEqual({code:'BRANCH_MOVEMENT_NOT_BALANCED',branchId:b});
  expect(result.companyReconciliation).toBeNull();
  expect(result.branchTrialBalances).toEqual([]);
 });

 it('rejects an unbalanced company opening masked by the next period journal',()=>{
  const d=data();d.branchIds=[];d.sourceLines=[
   {sourceId:'opening-cash',sourceKind:'OPENING',accountCode:'100001',debit:'100',credit:'0',
    allocations:[{branchId:null,debit:'100',credit:'0'}]},
   {sourceId:'journal-revenue',sourceKind:'JOURNAL',accountCode:'400001',debit:'0',credit:'100',
    allocations:[{branchId:null,debit:'0',credit:'100'}]},
  ];d.coverage.sourceCount=d.sourceLines.length;
  expect(()=>validateBranchAllocations(d)).toThrow('BRANCH_ALLOCATION_SOURCE_UNBALANCED');
 });
});
