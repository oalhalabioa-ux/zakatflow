import {feasibilityDraftSchema} from './draft-schema';
import type {FeasibilityStudy} from './engine';

export const FEASIBILITY_BACKUP_SCHEMA='YAQEEN_FEASIBILITY_DRAFT_V1';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const object=(value:unknown):value is Record<string,unknown> =>
 value!==null&&typeof value==='object'&&!Array.isArray(value);

/** Reject the complete unsafe collection, never silently discard corrupt studies. */
export function parseStudyCollection(value:unknown):FeasibilityStudy[]|null {
 if(!Array.isArray(value)||value.length>300)return null;
 const checked:FeasibilityStudy[]=[];
 const ids=new Set<string>();
 for(const entry of value){
  const parsed=feasibilityDraftSchema.safeParse(entry);
  if(!parsed.success||ids.has(parsed.data.id))return null;
  ids.add(parsed.data.id);
  checked.push(parsed.data);
 }
 return checked;
}

export function parseLocalStudyCache(raw:unknown):{studies:FeasibilityStudy[];selectedId:string}|null {
 if(!object(raw)||(raw.version!==undefined&&raw.version!==1))return null;
 const studies=parseStudyCollection(raw.studies);
 if(!studies)return null;
 const wanted=typeof raw.selectedId==='string'?raw.selectedId:'';
 return {studies,selectedId:studies.some(x=>x.id===wanted)?wanted:studies[0]?.id??''};
}
export function parseStudyBackup(raw:unknown):FeasibilityStudy[]|null {
 if(!object(raw)||raw.schema!==FEASIBILITY_BACKUP_SCHEMA)return null;
 return parseStudyCollection(raw.studies);
}
/** Prevent a stale account's data from being written into a different user's local key. */
export function canPersistLocalStudyCache(
 loaded:boolean,storageSafe:boolean,hydratedStorageKey:string,storageKey:string
):boolean {
 return loaded&&storageSafe&&hydratedStorageKey.length>0&&hydratedStorageKey===storageKey;
}

export type SavedCloudDraft={
 id:string;study:FeasibilityStudy;revision:number;owner_user_id:string;
};
export function parseCloudStudyRows(raw:unknown):SavedCloudDraft[]|null {
 if(!Array.isArray(raw)||raw.length>300)return null;
 const studies=parseStudyCollection(raw.map(x=>object(x)?x.study:null));
 if(!studies)return null;
 const rows:SavedCloudDraft[]=[];
 for(let i=0;i<raw.length;i++){
  const row=raw[i];
  const study=studies[i];
  if(!object(row)||row.id!==study.id||typeof row.owner_user_id!=='string'||
   !uuid.test(row.owner_user_id)||typeof row.revision!=='number'||
   !Number.isSafeInteger(row.revision)||row.revision<=0)return null;
  rows.push({id:study.id,study,revision:row.revision,owner_user_id:row.owner_user_id});
 }
 return rows;
}


/** Validates institution-scoped QA rows before displaying them. This is NOT
 * authorization; the database and API must independently enforce tenant RLS. */
export type InstitutionalCloudDraft={
 id:string;organization_id:string;owner_user_id:null;created_by_user_id:string|null;
 title:string;study:FeasibilityStudy;revision:number;updated_at:string;
};
export function parseInstitutionalCloudRows(raw:unknown,organizationId:string):InstitutionalCloudDraft[]|null {
 if(!uuid.test(organizationId)||!Array.isArray(raw)||raw.length>300)return null;
 const studies=parseStudyCollection(raw.map(x=>object(x)?x.study:null));
 if(!studies)return null;
 const result:InstitutionalCloudDraft[]=[];
 for(let i=0;i<raw.length;i++){
  const row=raw[i],study=studies[i];
  if(!object(row)||row.id!==study.id||row.organization_id!==organizationId||
   row.owner_user_id!==null||typeof row.title!=='string'||row.title!==study.title||
   (row.created_by_user_id!==null&&
    (typeof row.created_by_user_id!=='string'||!uuid.test(row.created_by_user_id)))||
   typeof row.revision!=='number'||!Number.isSafeInteger(row.revision)||row.revision<1||
   typeof row.updated_at!=='string'||!Number.isFinite(Date.parse(row.updated_at)))
   return null;
  result.push({
   id:study.id,organization_id:organizationId,owner_user_id:null,
   created_by_user_id:row.created_by_user_id as string|null,
   title:study.title,study,revision:row.revision,
   updated_at:row.updated_at
  });
 }
 return result;
}


/** Legacy cloud GET includes both owned and collaborator-readable PERSONAL studies.
 * A shared study must never be imported into the account's editable local drafts.
 * This is a client-side integrity guard, not a replacement for RLS. */
export function partitionPersonalCloudRows(
 rows:readonly SavedCloudDraft[],userId:string
):{owned:SavedCloudDraft[];shared:SavedCloudDraft[]}|null{
 if(!uuid.test(userId))return null;
 const owned:SavedCloudDraft[]=[],shared:SavedCloudDraft[]=[];
 for(const row of rows){
  if(row.owner_user_id===userId)owned.push(row);
  else shared.push(row);
 }
 return {owned,shared};
}

/** Keep local drafts and merge only owned cloud copies with missing IDs.
 * A divergent copy must never acquire the cloud revision for a later write. */
export function mergePersonalCloudDrafts(
 local:FeasibilityStudy[],rows:SavedCloudDraft[],userId:string,selectedId:string
){
 const partition=partitionPersonalCloudRows(rows,userId);
 if(!partition)return null;
 const localById=new Map(local.map(study=>[study.id,study]));
 const restored:FeasibilityStudy[]=[];
 const synchronized:SavedCloudDraft[]=[];
 let conflicts=0;
 // JSONB can change object key order. Keep array order significant.
 const orderedJson=(value:unknown)=>JSON.stringify(value,(_key,entry:unknown)=>
  object(entry)?Object.fromEntries(Object.keys(entry).sort().map(key=>[key,entry[key]])):entry);
 for(const row of partition.owned){
  const existing=localById.get(row.id);
  if(!existing)restored.push(row.study);
  else if(orderedJson(existing)!==orderedJson(row.study)){
   conflicts++;
   continue;
  }
  synchronized.push(row);
 }
 if(local.length+restored.length>300)return null;
 const studies=[...local,...restored];
 return {
  studies,selectedId:localById.has(selectedId)?selectedId:studies[0]?.id??'',
  synchronized,restoredCount:restored.length,conflicts
 };
}

/** Append a validated copy without replacing existing IDs or importing server ownership. */
export function appendImportedStudies(
 existing:FeasibilityStudy[],imports:FeasibilityStudy[],newId:()=>string
):{studies:FeasibilityStudy[];selectedId:string}|null {
 if(!imports.length||existing.length+imports.length>300)return null;
 const ids=new Set(existing.map(study=>study.id));
 const copies:FeasibilityStudy[]=[];
 const now=new Date().toISOString();
 for(const source of imports){
  const id=newId();
  if(!uuid.test(id)||ids.has(id))return null;
  ids.add(id);
  const {handoff: _handoff,...study}=source;
  copies.push({...study,id,createdAt:now,updatedAt:now});
 }
 return {studies:[...copies,...existing],selectedId:copies[0].id};
}
