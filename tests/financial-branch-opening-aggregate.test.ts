import {describe,expect,it} from 'vitest';
import {aggregateApprovedBranchOpenings,type OpeningAttributionInput} from '../lib/financial-branch-opening-aggregate';
import {previewVerifiedBranchAttribution} from '../lib/financial-branch-attribution';
import type {StatementSource} from '../lib/financial-statement-engine';
import type {JournalBranchObservation} from '../services/financial-branch-journal-source';
const org='10000000-0000-4000-8000-000000000001',branch='20000000-0000-4000-8000-000000000002';
function fixture():OpeningAttributionInput{
 const source:StatementSource={
  organizationId:org,currency:'SAR',openingDate:'2025-12-31',fiscalStart:'2026-01-01',
  from:'2026-01-01',to:'2026-11-07',
  accounts:[{id:'1000',organizationId:org,currency:'SAR',kind:'ASSET',cash:true},
   {id:'3100',organizationId:org,currency:'SAR',kind:'EQUITY'},
   {id:'4000',organizationId:org,currency:'SAR',kind:'REVENUE'}],
  opening:[{accountId:'1000',debit:'300.0000',credit:'0.0000'},
   {accountId:'3100',debit:'0.0000',credit:'300.0000'}],
  journals:[{id:'branch-sale',organizationId:org,currency:'SAR',
   status:'POSTED',date:'2026-03-01',lines:[{accountId:'1000',debit:'50',credit:'0',cashActivity:'OPERATING'},
    {accountId:'4000',debit:'0',credit:'50'}]}],
 };
 return{
  source,branchIds:[branch],sourceRevision:'canonical-revision-A',
  workspace:{id:'opening-w-1',organizationId:org,fiscalStart:'2026-01-01',currency:'SAR',
   version:5,status:'APPROVED',approvedOpening:[
    {itemId:'bank-1',accountCode:'1000',debit:'90.0000',credit:'0.0000'},
    {itemId:'bank-2',accountCode:'1000',debit:'210.0000',credit:'0.0000'},
    {itemId:'capital',accountCode:'3100',debit:'0.0000',credit:'300.0000'},
   ]},
  distribution:{status:'APPROVED',kind:'OPENING_DISTRIBUTION_EVIDENCE_ONLY',
   journalCoverageComplete:false,organizationId:org,openingWorkspaceId:'opening-w-1',
   openingVersion:5,openingDigest:'db-verified-revision',approvedBy:'independent-approver',
   entries:{
    'bank-1':[{branchId:null,debit:'90',credit:'0'}],
    'bank-2':[{branchId:null,debit:'10',credit:'0'},{branchId:branch,debit:'200',credit:'0'}],
    capital:[{branchId:null,debit:'0',credit:'100'},{branchId:branch,debit:'0',credit:'200'}],
   }},
 };
}
describe('per-voucher approved branch opening attribution',()=>{
 it('aggregates two original bank vouchers without duplicating balance or losing the source identity',()=>{
  const input=fixture(),prior=JSON.stringify(input);
  const out=aggregateApprovedBranchOpenings(input);
  expect(out.status).toBe('OPENING_ATTRIBUTION_RECONCILED_PREVIEW_ONLY');
  if(out.status!=='OPENING_ATTRIBUTION_RECONCILED_PREVIEW_ONLY')return;
  expect(out.itemCount).toBe(3);
  expect(out.openingEvidence?.rows).toContainEqual({sourceId:'OPEN:1000',accountCode:'1000',
   debit:'300.0000',credit:'0.0000',allocations:[
    {branchId:null,debit:'100.0000',credit:'0.0000'},
    {branchId:branch,debit:'200.0000',credit:'0.0000'}]});
  const journals:JournalBranchObservation={status:'RLS_MATCHED_JOURNAL_REFERENCES_ONLY',
   organizationId:org,links:[{journalId:'branch-sale',branchId:branch,scope:'BRANCH'}]};
  const preview=previewVerifiedBranchAttribution({source:input.source,branchIds:input.branchIds,
   coverage:{complete:true,scope:'ORGANIZATION_ALL_ENTITIES',sourceCount:4,
    revision:input.sourceRevision},journalEvidence:journals,openingEvidence:out.openingEvidence});
  expect(preview.status).toBe('RECONCILED_SEGMENTS_PREVIEW_ONLY');
  if(preview.status==='RECONCILED_SEGMENTS_PREVIEW_ONLY'){
   expect(preview.company?.position.assets).toBe('350.0000');
   expect(preview.segments.find(s=>s.branchId===null)?.statement.cash.closing).toBe('100.0000');
   expect(preview.segments.find(s=>s.branchId===branch)?.statement.cash.closing).toBe('250.0000');
  }
  expect(JSON.stringify(input)).toBe(prior);
 });
 it('blocks missing source items, duplicated identities and unknown extra allocation keys',()=>{
  const a=fixture();delete (a.distribution!.entries as Record<string,unknown>)['bank-1'];
  expect(aggregateApprovedBranchOpenings(a)).toMatchObject({status:'OPENING_ATTRIBUTION_BLOCKED',code:'OPENING_LINE_UNATTRIBUTED'});
  const b=fixture();b.workspace!.approvedOpening=[...b.workspace!.approvedOpening,b.workspace!.approvedOpening[0]];
  expect(aggregateApprovedBranchOpenings(b)).toMatchObject({status:'OPENING_ATTRIBUTION_BLOCKED',code:'OPENING_SOURCE_ITEM_INVALID'});
  const c=fixture();(c.distribution!.entries as Record<string,unknown>)['foreign-item']=[];
  expect(aggregateApprovedBranchOpenings(c)).toMatchObject({status:'OPENING_ATTRIBUTION_BLOCKED',code:'OPENING_DISTRIBUTION_UNRECOGNIZED_ITEM'});
 });
 it('blocks altered sums, duplicate branch splits, foreign branch and mismatched current workspace',()=>{
  const a=fixture();a.distribution!.entries['bank-2'][1].debit='199.0000';
  expect(aggregateApprovedBranchOpenings(a).status).toBe('OPENING_ATTRIBUTION_BLOCKED');
  const b=fixture();b.distribution!.entries['bank-2']=[...b.distribution!.entries['bank-2'],
    {branchId:branch,debit:'0',credit:'0'}];
  expect(aggregateApprovedBranchOpenings(b).status).toBe('OPENING_ATTRIBUTION_BLOCKED');
  const c=fixture();c.distribution!.entries['bank-2'][1].branchId='outside-company';
  expect(aggregateApprovedBranchOpenings(c).status).toBe('OPENING_ATTRIBUTION_BLOCKED');
  const d=fixture();d.workspace!.version=6;
  expect(aggregateApprovedBranchOpenings(d)).toMatchObject({code:'OPENING_SOURCE_STALE'});
 });
 it('never claims a draft, stale or independently unapproved distribution is certified',()=>{
  const a=fixture();a.distribution!.status='STALE';
  expect(aggregateApprovedBranchOpenings(a).status).toBe('OPENING_ATTRIBUTION_BLOCKED');
  const b=fixture();b.distribution!.approvedBy=null;
  expect(aggregateApprovedBranchOpenings(b).status).toBe('OPENING_ATTRIBUTION_BLOCKED');
 });
 it('accepts first-activity source with no opening records, without making any synthetic allocation',()=>{
  const x=fixture();x.source.opening=[];x.workspace=null;x.distribution=null;
  const result=aggregateApprovedBranchOpenings(x);
  expect(result).toEqual({status:'OPENING_ATTRIBUTION_RECONCILED_PREVIEW_ONLY',
   itemCount:0,openingEvidence:null});
 });
 it('reconciles a new branch with no opening workspace through observed posted journals',()=>{
  const x=fixture();
  x.source.opening=[];x.workspace=null;x.distribution=null;
  const opening=aggregateApprovedBranchOpenings(x);
  expect(opening).toEqual({status:'OPENING_ATTRIBUTION_RECONCILED_PREVIEW_ONLY',
   itemCount:0,openingEvidence:null});
  const journals:JournalBranchObservation={status:'RLS_MATCHED_JOURNAL_REFERENCES_ONLY',
   organizationId:org,links:[{journalId:'branch-sale',branchId:branch,scope:'BRANCH'}]};
  const sourceCount=x.source.journals[0].lines.length;
  const preview=previewVerifiedBranchAttribution({
   source:x.source,branchIds:x.branchIds,
   coverage:{complete:true,scope:'ORGANIZATION_ALL_ENTITIES',sourceCount,
    revision:x.sourceRevision},journalEvidence:journals,openingEvidence:null,
  });
  expect(preview.status).toBe('RECONCILED_SEGMENTS_PREVIEW_ONLY');
  if(preview.status==='RECONCILED_SEGMENTS_PREVIEW_ONLY'){
   expect(preview.segments.find(s=>s.branchId===branch)?.statement.cash)
    .toMatchObject({opening:'0.0000',closing:'50.0000'});
   expect(preview.segments.find(s=>s.branchId===branch)?.statement.income.netProfit).toBe('50.0000');
  }
 });
 it('does not bypass existing unapproved opening evidence by claiming a zero-opening startup',()=>{
  const x=fixture();
  x.source.opening=[];x.workspace=null;
  // A stored distribution exists and must not be silently ignored.
  expect(aggregateApprovedBranchOpenings(x).status).toBe('OPENING_ATTRIBUTION_BLOCKED');
 });

 it('needs no distribution for a genuinely approved empty opening workspace',()=>{
  const x=fixture();x.source.opening=[];x.distribution=null;
  x.workspace!.approvedOpening=[];
  expect(aggregateApprovedBranchOpenings(x)).toEqual({
   status:'OPENING_ATTRIBUTION_RECONCILED_PREVIEW_ONLY',itemCount:0,openingEvidence:null,
  });
  x.workspace!.status='DRAFT';
  expect(aggregateApprovedBranchOpenings(x)).toMatchObject({
   status:'OPENING_ATTRIBUTION_BLOCKED',code:'OPENING_SOURCE_STALE',
  });
 });
 it('does not reinterpret a nonempty or foreign approved opening as a zero-opening company',()=>{
  const x=fixture();x.source.opening=[];x.distribution=null;
  expect(aggregateApprovedBranchOpenings(x)).toMatchObject({
   status:'OPENING_ATTRIBUTION_BLOCKED',code:'OPENING_SOURCE_STALE',
  });
  x.workspace!.approvedOpening=[];x.workspace!.organizationId='another-company';
  expect(aggregateApprovedBranchOpenings(x)).toMatchObject({
   status:'OPENING_ATTRIBUTION_BLOCKED',code:'OPENING_SOURCE_STALE',
  });
 });

});
