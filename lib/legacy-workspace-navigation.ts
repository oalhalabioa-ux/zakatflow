import {clearOrganizationScopeQuery} from './topbar-navigation';

/** Legacy Zakat consolidation is replaced by the real assessment workspace, retaining explicit ownership. */
export function legacyAssessmentHref(locale:string,query:Record<string,string|string[]|undefined>){
 const q=new URLSearchParams();
 for(const[key,value]of Object.entries(query)){const first=Array.isArray(value)?value[0]:value;if(first!==undefined)q.set(key,first)}
 const scope=q.get('scope')==='ORGANIZATION'?'ORGANIZATION':q.get('scope')==='PERSONAL'?'PERSONAL':q.has('organization')||q.has('organization_id')?'ORGANIZATION':'PERSONAL';
 q.set('scope',scope);
 if(scope==='PERSONAL'){clearOrganizationScopeQuery(q);if(q.get('source')!=='manual')q.set('source','register')}
 else{if(!q.has('organization')&&q.has('organization_id'))q.set('organization',q.get('organization_id')!);q.delete('organization_id');q.set('source','manual')}
 return `/${locale}/assessments?${q}`;
}
