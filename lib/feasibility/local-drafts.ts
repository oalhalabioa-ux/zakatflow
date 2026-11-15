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
