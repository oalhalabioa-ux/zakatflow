import evidence from './qa-live-opening-snapshot.json';
const branch='20000000-0000-4000-8000-000000000002';
export function branchFixture(){
 const source=structuredClone(evidence.snapshots[1].payload),org=source.organizationId;
 const rows=source.opening.map(r=>({itemId:'item:'+r.accountId,accountCode:r.accountId,debit:r.debit,credit:r.credit}));
 return{version:1,revision:'a'.repeat(32),source,
  entities:[{id:branch,organizationId:org,name:'Branch A',entityType:'BRANCH',active:false}],
  workspace:{id:source.openingSourceId,organizationId:org,fiscalStart:source.fiscalStart,currency:source.currency,version:3,status:'APPROVED',approvedOpening:rows},
  distribution:{status:'APPROVED',kind:'OPENING_DISTRIBUTION_EVIDENCE_ONLY',organizationId:org,
   openingWorkspaceId:source.openingSourceId,openingVersion:3,openingDigest:'approved-digest',approvedBy:'approver',journalCoverageComplete:false,
   entries:Object.fromEntries(rows.map(r=>[r.itemId,[
    {branchId:branch,debit:r.debit==='500.0000'?'300.0000':'0.0000',credit:r.credit==='500.0000'?'300.0000':'0.0000'},
    {branchId:null,debit:r.debit==='500.0000'?'200.0000':'0.0000',credit:r.credit==='500.0000'?'200.0000':'0.0000'},
   ]]))},
  journalEvidence:{status:'RLS_MATCHED_JOURNAL_REFERENCES_ONLY',organizationId:org,
   links:source.events.map(e=>({journalId:e.id,branchId:e.eventType==='REVENUE'?null:branch,scope:e.eventType==='REVENUE'?'ORGANIZATION_DIRECT':'BRANCH'}))},
 };
}
