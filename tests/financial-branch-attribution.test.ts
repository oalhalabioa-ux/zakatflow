import {describe,expect,it} from 'vitest';
import {previewVerifiedBranchAttribution,type BranchOpeningEvidence,type ZeroOpeningSourceEvidence} from '../lib/financial-branch-attribution';
import type {StatementSource} from '../lib/financial-statement-engine';
import type {JournalBranchObservation} from '../services/financial-branch-journal-source';

const org='10000000-0000-4000-8000-000000000001',branch='branch-one';
function fixtures(){
 const source:StatementSource={organizationId:org,currency:'SAR',openingDate:'2025-12-31',
  fiscalStart:'2026-01-01',from:'2026-01-01',to:'2026-11-06',
  accounts:[{id:'1000',organizationId:org,currency:'SAR',kind:'ASSET',cash:true},
   {id:'3100',organizationId:org,currency:'SAR',kind:'EQUITY'},
   {id:'4000',organizationId:org,currency:'SAR',kind:'REVENUE'}],
  opening:[{accountId:'1000',debit:'300.0000',credit:'0.0000'},
   {accountId:'3100',debit:'0.0000',credit:'300.0000'}],
  journals:[
   {id:'hq-income',organizationId:org,currency:'SAR',status:'POSTED',date:'2026-03-01',
    lines:[{accountId:'1000',debit:'20.0000',credit:'0.0000',cashActivity:'OPERATING'},
     {accountId:'4000',debit:'0.0000',credit:'20.0000'}]},
   {id:'branch-income',organizationId:org,currency:'SAR',status:'POSTED',date:'2026-04-01',
    lines:[{accountId:'1000',debit:'50.0000',credit:'0.0000',cashActivity:'OPERATING'},
     {accountId:'4000',debit:'0.0000',credit:'50.0000'}]},
  ]};
 const coverage={complete:true as const,scope:'ORGANIZATION_ALL_ENTITIES' as const,
  sourceCount:6,revision:'verified-full-ledger-v1'};
 const journalEvidence:JournalBranchObservation={status:'RLS_MATCHED_JOURNAL_REFERENCES_ONLY',
  organizationId:org,links:[{journalId:'hq-income',branchId:null,scope:'ORGANIZATION_DIRECT'},
   {journalId:'branch-income',branchId:branch,scope:'BRANCH'}]};
 const openingEvidence:BranchOpeningEvidence={status:'APPROVED',organizationId:org,currency:'SAR',
  fiscalStart:'2026-01-01',approvedVersion:3,approvedBy:'reviewer',ledgerRevision:coverage.revision,rows:[
   {sourceId:'OPEN:1000',accountCode:'1000',debit:'300.0000',credit:'0.0000',
    allocations:[{branchId:null,debit:'100.0000',credit:'0.0000'},{branchId:branch,debit:'200.0000',credit:'0.0000'}]},
   {sourceId:'OPEN:3100',accountCode:'3100',debit:'0.0000',credit:'300.0000',
    allocations:[{branchId:null,debit:'0.0000',credit:'100.0000'},{branchId:branch,debit:'0.0000',credit:'200.0000'}]},
  ]};
 return{source,branchIds:[branch],coverage,journalEvidence,openingEvidence};
}
describe('read-only versioned source-to-segment attribution',()=>{
 it('reconciles full company against HQ and branch income, position and cash without changing input',()=>{
  const data=fixtures(),original=JSON.stringify(data);
  const result=previewVerifiedBranchAttribution(data);
  expect(result.status).toBe('RECONCILED_SEGMENTS_PREVIEW_ONLY');
  if(result.status!=='RECONCILED_SEGMENTS_PREVIEW_ONLY')return;
  expect(result.company?.position.assets).toBe('370.0000');
  expect(result.company?.income.netProfit).toBe('70.0000');
  expect(result.segments.find(x=>x.branchId===null)?.statement.cash.closing).toBe('120.0000');
  expect(result.segments.find(x=>x.branchId===branch)?.statement.cash.closing).toBe('250.0000');
  expect(JSON.stringify(data)).toBe(original);
 });
 it('blocks without independently approved opening allocation instead of guessing account ownership',()=>{
  const data=fixtures();Object.assign(data,{openingEvidence:null});
  expect(previewVerifiedBranchAttribution(data)).toEqual({
   status:'BLOCKED',issues:['BRANCH_OPENING_EVIDENCE_REQUIRED'],company:null,segments:[]});
 });
 it('blocks stale or altered opening revision and incomplete allocation rows',()=>{
  const data=fixtures();data.openingEvidence.ledgerRevision='old-revision';
  expect(previewVerifiedBranchAttribution(data).status).toBe('BLOCKED');
  data.openingEvidence.ledgerRevision=data.coverage.revision;
  data.openingEvidence.rows=data.openingEvidence.rows.slice(0,1);
  expect(previewVerifiedBranchAttribution(data)).toMatchObject({status:'BLOCKED',
   issues:['BRANCH_OPENING_EVIDENCE_INVALID']});
 });
 it('blocks hidden, extra or ambiguous posted journal branch evidence',()=>{
  const data=fixtures();data.journalEvidence.links=data.journalEvidence.links.slice(0,1);
  expect(previewVerifiedBranchAttribution(data)).toMatchObject({status:'BLOCKED',
   issues:['BRANCH_JOURNAL_EVIDENCE_MISSING']});
  data.journalEvidence.links=[{journalId:'hq-income',branchId:null,scope:'ORGANIZATION_DIRECT'},
   {journalId:'branch-income',branchId:'other-company-branch',scope:'BRANCH'}];
  expect(previewVerifiedBranchAttribution(data)).toMatchObject({status:'BLOCKED',
   issues:['BRANCH_JOURNAL_EVIDENCE_INVALID']});
 });
 it('prevents a balanced company opening from concealing an unbalanced branch opening',()=>{
  const data=fixtures();data.openingEvidence.rows[0].allocations=[
   {branchId:null,debit:'150.0000',credit:'0.0000'},
   {branchId:branch,debit:'150.0000',credit:'0.0000'},
  ];
  expect(previewVerifiedBranchAttribution(data)).toMatchObject({status:'BLOCKED',company:null,segments:[]});
 });
 it('permits genuine first-activity company with no opening and no branches',()=>{
  const data=fixtures();data.branchIds=[];data.source.opening=[];Object.assign(data,{openingEvidence:null});
  data.source.journals=[{id:'capital-receipt',organizationId:org,currency:'SAR',status:'POSTED',date:'2026-01-02',
   lines:[{accountId:'1000',debit:'100.0000',credit:'0.0000',cashActivity:'FINANCING'},
    {accountId:'3100',debit:'0.0000',credit:'100.0000'}]}];
  data.journalEvidence.links=[{journalId:'capital-receipt',branchId:null,scope:'ORGANIZATION_DIRECT'}];
  data.coverage.sourceCount=2;
  expect(previewVerifiedBranchAttribution(data)).toMatchObject({status:'BLOCKED',
   issues:['BRANCH_ZERO_OPENING_PROVENANCE_REQUIRED']});
  Object.assign(data,{zeroOpeningEvidence:{status:'ZERO_OPENING_SOURCE_EVIDENCE_ONLY',
   organizationId:org,currency:'SAR',fiscalStart:'2026-01-01',ledgerRevision:data.coverage.revision,
   sourceReference:'canonical-first-activity-2026',openingLineCount:0,
   pendingOpeningCount:0,priorOpeningSourceCount:0}});
  const result=previewVerifiedBranchAttribution(data);
  expect(result.status).toBe('RECONCILED_SEGMENTS_PREVIEW_ONLY');
  if(result.status==='RECONCILED_SEGMENTS_PREVIEW_ONLY')
   expect(result.segments[0].statement.position.assets).toBe('100.0000');
 });
 it('rejects stale, foreign or incomplete zero-opening provenance without guessing an opening entry',()=>{
  const data=fixtures();data.source.opening=[];Object.assign(data,{openingEvidence:null});
  data.coverage.sourceCount=4;
  const evidence:ZeroOpeningSourceEvidence={status:'ZERO_OPENING_SOURCE_EVIDENCE_ONLY',organizationId:org,currency:'SAR',
   fiscalStart:'2026-01-01',ledgerRevision:data.coverage.revision,
   sourceReference:'first-activity',openingLineCount:0,pendingOpeningCount:0,priorOpeningSourceCount:0};
  for(const invalid of [
   {...evidence,organizationId:'other-company'},
   {...evidence,ledgerRevision:'older-revision'},
   {...evidence,pendingOpeningCount:1},
   {...evidence,priorOpeningSourceCount:1},
   {...evidence,sourceReference:''},
  ]){
   const result=previewVerifiedBranchAttribution({...data,zeroOpeningEvidence:invalid as unknown as ZeroOpeningSourceEvidence});
   expect(result).toMatchObject({status:'BLOCKED',
    issues:['BRANCH_ZERO_OPENING_PROVENANCE_INVALID'],company:null,segments:[]});
  }
 });
});
