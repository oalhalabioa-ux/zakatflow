import {describe,expect,it} from 'vitest';
import {validateBranchAllocations,type BranchAllocationInput,type BranchSourceLine} from '../lib/financial-branch-allocation';

const a='branch-a',b='branch-b';
type MutableBranchLine=Omit<BranchSourceLine,'allocations'>&{allocations:{branchId:string;debit:string;credit:string}[]};
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
 });

 it('never invents an allocation for approved opening amounts',()=>{
  const d=data();d.sourceLines[0].allocations=[];
  const r=validateBranchAllocations(d);
  expect(r.status).toBe('BLOCKED');
  expect(r.issues).toContainEqual({code:'MISSING_ALLOCATION',sourceId:'opening-bank'});
  expect(r.branchTrialBalances).toEqual([]);
 });

 it('rejects short allocation totals without presenting partial branch financials',()=>{
  const d=data();d.sourceLines[1].allocations=[{branchId:a,debit:'0',credit:'50'},{branchId:b,debit:'0',credit:'60'}];
  const r=validateBranchAllocations(d);
  expect(r.status).toBe('BLOCKED');
  expect(r.issues.some(i=>i.code==='ALLOCATION_MISMATCH')).toBe(true);
  expect(r.branchTrialBalances).toEqual([]);
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

 it('requires an explicit complete authoritative source attestation, not a merely balanced subset',()=>{
  const d=data();d.coverage.sourceCount=3;
  expect(()=>validateBranchAllocations(d)).toThrow('BRANCH_ALLOCATION_SOURCE_INCOMPLETE');
  const unsafe=data();unsafe.coverage.complete=false as true;
  expect(()=>validateBranchAllocations(unsafe)).toThrow('BRANCH_ALLOCATION_SOURCE_INCOMPLETE');
 });
});
