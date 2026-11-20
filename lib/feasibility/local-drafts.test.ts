import {describe,expect,it} from 'vitest';
import {createStudy} from './engine';
import {appendImportedStudies,parseStudyCollection,parseLocalStudyCache,parseStudyBackup,parseCloudStudyRows,parseInstitutionalCloudRows,partitionPersonalCloudRows,mergePersonalCloudDrafts,personalCloudRevisionForBaseline,personalDraftCache,readPersonalCloudVersions,canPersistLocalStudyCache,FEASIBILITY_BACKUP_SCHEMA,type SavedCloudDraft} from './local-drafts';

const id='6357a708-bae2-4634-9296-490404b1d8a4';
const owner='09d4c3bb-c5ee-4ac5-9b64-8127a2e55b98';
const study=()=>createStudy(id,'Independent study','SERVICES');

describe('local feasibility import/cache fail-closed validation',()=>{
 it('never permits a previous account\'s state to overwrite another local cache',()=>{
  const alice='yaqeen-feasibility-drafts-v1:alice',bob='yaqeen-feasibility-drafts-v1:bob';
  expect(canPersistLocalStudyCache(true,true,alice,alice)).toBe(true);
  expect(canPersistLocalStudyCache(true,true,alice,bob)).toBe(false);
  expect(canPersistLocalStudyCache(true,true,'',bob)).toBe(false);
  expect(canPersistLocalStudyCache(false,true,bob,bob)).toBe(false);
  expect(canPersistLocalStudyCache(true,false,bob,bob)).toBe(false);
 });
 it('accepts compatible legacy cache with optional version and missing selection',()=>{
  const s=study();
  expect(parseLocalStudyCache({studies:[s]})).toMatchObject({selectedId:id,studies:[s]});
  expect(parseLocalStudyCache({version:1,studies:[s],selectedId:'unknown'})).toMatchObject({selectedId:id});
  expect(parseLocalStudyCache({version:1,studies:[],selectedId:id})).toEqual({studies:[],selectedId:''});
 });
 it('rejects future schema versions, malformed and duplicate studies without dropping entries',()=>{
  const s=study();
  expect(parseLocalStudyCache({version:2,studies:[s]})).toBeNull();
  expect(parseStudyCollection([s,{...s,id:'invalid'}])).toBeNull();
  expect(parseStudyCollection([s,{...s}])).toBeNull();
  expect(parseStudyCollection([{...s,unitPrice:-1}])).toBeNull();
  expect(parseStudyCollection([{...s,legal:[{title:'malformed'}]}])).toBeNull();
  expect(parseStudyCollection([{...s,owner_user_id:owner}])).toBeNull();
  expect(parseStudyCollection(Array.from({length:301},()=>s))).toBeNull();
 });
 it('checks the complete exported backup rather than only surface arrays',()=>{
  const s=study();
  expect(parseStudyBackup({schema:FEASIBILITY_BACKUP_SCHEMA,studies:[s]})).toEqual([s]);
  expect(parseStudyBackup({schema:'UNKNOWN',studies:[s]})).toBeNull();
  expect(parseStudyBackup({schema:FEASIBILITY_BACKUP_SCHEMA,studies:[{...s,suppliers:[{id:'1',vendor:'A',item:'I',offer:-500,notes:''}]}]})).toBeNull();
 });
 it('rejects malformed cloud owner/revision metadata before restoring drafts',()=>{
  const s=study(),good={id:s.id,study:s,revision:1,owner_user_id:owner};
  expect(parseCloudStudyRows([good])).toEqual([good]);
  expect(parseCloudStudyRows([{...good,revision:0}])).toBeNull();
  expect(parseCloudStudyRows([{...good,owner_user_id:'not-a-uuid'}])).toBeNull();
  expect(parseCloudStudyRows([{...good,id:'another'}])).toBeNull();
  expect(parseCloudStudyRows([{...good,study:{...s,unitPrice:Infinity}}])).toBeNull();
  expect(parseCloudStudyRows([good,good])).toBeNull();
 });
});


describe('institutional feasibility cloud snapshot validation',()=>{
 const organization='b67fa2de-0da1-4bd7-b2af-35e72a0732fd';
 const otherOrganization='9a488471-6f07-44c0-8c6b-69a298bd4eab';
 const s=study();
 const good={
  id:s.id,organization_id:organization,owner_user_id:null,created_by_user_id:owner,
  title:s.title,study:s,revision:2,updated_at:'2026-11-15T16:00:00Z'
 };
 it('accepts institution-owned study and retains creator provenance separately',()=>{
  expect(parseInstitutionalCloudRows([good],organization)).toEqual([good]);
 });
 it('rejects cross-organization data even from a forged server response',()=>{
  expect(parseInstitutionalCloudRows([good],otherOrganization)).toBeNull();
  expect(parseInstitutionalCloudRows([{...good,organization_id:otherOrganization}],organization)).toBeNull();
 });
 it('rejects personal owner, stale or invalid revision and inconsistent study metadata',()=>{
  expect(parseInstitutionalCloudRows([{...good,owner_user_id:owner}],organization)).toBeNull();
  expect(parseInstitutionalCloudRows([{...good,revision:0}],organization)).toBeNull();
  expect(parseInstitutionalCloudRows([{...good,title:'forged title'}],organization)).toBeNull();
  expect(parseInstitutionalCloudRows([{...good,created_by_user_id:'forged'}],organization)).toBeNull();
  expect(parseInstitutionalCloudRows([{...good,updated_at:'not-a-date'}],organization)).toBeNull();
  expect(parseInstitutionalCloudRows([good,good],organization)).toBeNull();
 });
 it('accepts creator deletion without reclassifying the corporate study as personal',()=>{
  expect(parseInstitutionalCloudRows([{...good,created_by_user_id:null}],organization))
    .toMatchObject([{organization_id:organization,owner_user_id:null,created_by_user_id:null}]);
 });
});


describe('legacy cloud restore never promotes shared user studies into local ownership',()=>{
 const owner='09d4c3bb-c5ee-4ac5-9b64-8127a2e55b98';
 const invitee='1fce6c75-e43d-45c9-955b-d06626aa491d';
 const ownStudy=createStudy('38b5e2ec-2732-4f9a-8d65-d06a22aeab5e','My study');
 const sharedStudy=createStudy('e33bcc0e-e1d4-4cf6-86f1-a2148cfa344b','Someone else\'s study');
 const rows=[
  {id:sharedStudy.id,study:sharedStudy,revision:2,owner_user_id:invitee},
  {id:ownStudy.id,study:ownStudy,revision:1,owner_user_id:owner}
 ];
 it('keeps personal owner records separate from shared read-only records',()=>{
  const parts=partitionPersonalCloudRows(rows,owner);
  expect(parts?.owned.map(x=>x.id)).toEqual([ownStudy.id]);
  expect(parts?.shared.map(x=>x.id)).toEqual([sharedStudy.id]);
  expect(rows.map(x=>x.id)).toEqual([sharedStudy.id,ownStudy.id]);
 });
 it('rejects invalid identity rather than guessing ownership',()=>{
  expect(partitionPersonalCloudRows(rows,'invalid')).toBeNull();
 });
 it('does not mutate original remote entries or create fake personal ownership',()=>{
  const first=JSON.stringify(rows);
  partitionPersonalCloudRows(rows,owner);
  expect(JSON.stringify(rows)).toBe(first);
  expect(rows[0].owner_user_id).toBe(invitee);
 });
});

const ownerId='00000000-0000-4000-8000-000000000001';
const collaboratorId='00000000-0000-4000-8000-000000000002';
const draft=(n:number)=>createStudy('00000000-0000-4000-8000-'+String(n).padStart(12,'0'),'Study '+n);
const row=(study:ReturnType<typeof draft>,owner=ownerId):SavedCloudDraft=>({
 id:study.id,study,owner_user_id:owner,revision:3
});

describe('personal cloud restore',()=>{
 it('adds only missing owned drafts and keeps the selection and local originals',()=>{
  const local=draft(3), missing=draft(4), matching=draft(5);
  const reordered=Object.fromEntries(Object.entries(matching).reverse()) as typeof matching;
  const merged=mergePersonalCloudDrafts([local,matching],[row(missing),row(reordered),row(draft(6),collaboratorId)],ownerId,local.id);
  expect(merged).toMatchObject({
   studies:[local,matching,missing],selectedId:local.id,
   synchronized:[row(missing),row(reordered)],restoredCount:1,conflicts:0
  });
  expect(mergePersonalCloudDrafts(merged!.studies,[row(missing)],ownerId,local.id)?.restoredCount).toBe(0);
 });

 it('keeps divergent content without using the cloud revision even when timestamps match',()=>{
  const local=draft(3);
  const cloud={...local,title:'Divergent cloud version'};
  expect(mergePersonalCloudDrafts([local],[row(cloud)],ownerId,local.id)).toEqual({
   studies:[local],selectedId:local.id,synchronized:[],restoredCount:0,conflicts:1
  });
 });

 it('keeps local drafts if the cloud is empty and refuses a merge over the portfolio limit',()=>{
  const local=Array.from({length:300},(_,index)=>draft(index+3));
  expect(mergePersonalCloudDrafts(local,[],ownerId,'')).toMatchObject({studies:local,selectedId:local[0].id});
  expect(mergePersonalCloudDrafts(local,[row(draft(303))],ownerId,local[0].id)).toBeNull();
 });
});

it('recovers the save revision only while the owned cloud content matches the reloaded baseline',()=>{
 const baseline=draft(3);
 const reordered=Object.fromEntries(Object.entries(baseline).reverse()) as typeof baseline;
 expect(personalCloudRevisionForBaseline(baseline,[row(reordered)],ownerId)).toBe(3);
 expect(personalCloudRevisionForBaseline(baseline,[row({...baseline,title:'Edited elsewhere'})],ownerId)).toBeNull();
 expect(personalCloudRevisionForBaseline(baseline,[row(reordered,collaboratorId)],ownerId)).toBeNull();
 expect(personalCloudRevisionForBaseline(baseline,[row(draft(4))],ownerId)).toBeNull();
});


it('preserves the last verified revision across dirty reloads without inheriting it on import',()=>{
 const saved=study();
 const edited={...saved,unitPrice:10,updatedAt:'2026-11-20T12:00:00.000Z'};
 const cache=JSON.parse(JSON.stringify(personalDraftCache([edited],id,{[id]:7},{[id]:saved.updatedAt})));
 const restored=parseLocalStudyCache(cache)!;
 expect(restored.studies).toEqual([edited]);
 const known=readPersonalCloudVersions(cache,restored.studies);
 expect(known).toEqual({revisions:{[id]:7},savedVersions:{[id]:saved.updatedAt}});
 const imported=appendImportedStudies(restored.studies,[saved],()=>draft(6).id)!;
 const afterImport=personalDraftCache(imported.studies,imported.selectedId,known.revisions,known.savedVersions);
 expect(readPersonalCloudVersions(afterImport,imported.studies)).toEqual(known);
 expect(imported.selectedId).not.toBe(id);
 expect(readPersonalCloudVersions({studies:[saved]},[saved])).toEqual({revisions:{},savedVersions:{}});
 expect(readPersonalCloudVersions({cloudVersions:{[id]:{revision:-1,updatedAt:saved.updatedAt}}},[saved]).revisions).toEqual({});
});
