import {z} from 'zod';
import type {WorkspaceScope} from './topbar-navigation';
export const operationalReportTypes=['assets','assessments','transactions','lots','payments'] as const;
export type OperationalReportType=typeof operationalReportTypes[number];
export const operationalReportScopeSchema=z.object({
 scope:z.enum(['PERSONAL','ORGANIZATION']).default('PERSONAL'),
 organization_id:z.string().uuid().nullable().default(null),
 entity_id:z.string().uuid().nullable().default(null),
 group:z.boolean().default(false),
}).strict().superRefine((p,c)=>{
 if(p.scope==='PERSONAL'&&(p.organization_id||p.entity_id||p.group)||p.scope==='ORGANIZATION'&&!p.organization_id)c.addIssue({code:'custom',message:'REPORT_SCOPE_INVALID'});
});
export type OperationalReportScope=z.infer<typeof operationalReportScopeSchema>;
export type ReportScopeSelection={scope:WorkspaceScope;organization:string;entity:string;group:boolean};
export function readOperationalReportScope(q:URLSearchParams){
 for(const key of ['scope','organization','organization_id','entity','entity_id','level','group'])if(q.getAll(key).length>1)throw Error('REPORT_SCOPE_INVALID');
 if(q.has('organization')&&q.has('organization_id')&&q.get('organization')!==q.get('organization_id')||q.has('entity')&&q.has('entity_id')&&q.get('entity')!==q.get('entity_id')||q.has('level')&&!['COMPANY','GROUP'].includes(q.get('level')!)||q.has('group')&&!['0','1'].includes(q.get('group')!)||q.has('group')&&q.has('level')&&(q.get('group')==='1')!==(q.get('level')==='GROUP'))throw Error('REPORT_SCOPE_INVALID');
 return operationalReportScopeSchema.parse({scope:q.get('scope')??'PERSONAL',organization_id:q.get('organization_id')??q.get('organization'),entity_id:q.get('entity_id')??q.get('entity'),group:q.get('group')==='1'||q.get('level')==='GROUP'});
}
export function operationalReportQuery(selection:ReportScopeSelection,canonical=false){
 const q=new URLSearchParams({scope:selection.scope});
 if(selection.scope==='ORGANIZATION'){
  if(!selection.organization)return null;
  q.set(canonical?'organization':'organization_id',selection.organization);
  if(canonical)q.set('level',selection.group?'GROUP':'COMPANY');else if(selection.group)q.set('group','1');
  if(selection.entity)q.set(canonical?'entity':'entity_id',selection.entity);
 }
 return q;
}
