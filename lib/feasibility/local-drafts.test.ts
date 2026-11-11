import {describe,expect,it} from 'vitest';
import {createStudy} from './engine';
import {parseStudyCollection,parseLocalStudyCache,parseStudyBackup,parseCloudStudyRows,FEASIBILITY_BACKUP_SCHEMA} from './local-drafts';

const id='6357a708-bae2-4634-9296-490404b1d8a4';
const owner='09d4c3bb-c5ee-4ac5-9b64-8127a2e55b98';
const study=()=>createStudy(id,'Independent study','SERVICES');

describe('local feasibility import/cache fail-closed validation',()=>{
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
 it('rejects malformed cloud owner/revision metadata before replacing local drafts',()=>{
  const s=study(),good={id:s.id,study:s,revision:1,owner_user_id:owner};
  expect(parseCloudStudyRows([good])).toEqual([good]);
  expect(parseCloudStudyRows([{...good,revision:0}])).toBeNull();
  expect(parseCloudStudyRows([{...good,owner_user_id:'not-a-uuid'}])).toBeNull();
  expect(parseCloudStudyRows([{...good,id:'another'}])).toBeNull();
  expect(parseCloudStudyRows([{...good,study:{...s,unitPrice:Infinity}}])).toBeNull();
  expect(parseCloudStudyRows([good,good])).toBeNull();
 });
});
