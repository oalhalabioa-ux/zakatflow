import {clearOrganizationScopeQuery} from './topbar-navigation';

/** Old register bookmarks point at the same institution in the unified VAT page. */
export function invoiceRegisterHref(locale:string,query:Record<string,string|string[]|undefined>){
 const params=new URLSearchParams({section:'unified'});
 for(const [key,value] of Object.entries(query))if(typeof value==='string'&&!['section','scope','organization_id'].includes(key))params.set(key,value);
 const organization=query.organization??query.organization_id;
 if(typeof organization==='string')params.set('organization',organization);
 if(query.scope==='PERSONAL'){
  params.set('scope','PERSONAL');
  clearOrganizationScopeQuery(params);
  params.delete('document_id');
 }else if(query.scope==='ORGANIZATION'||typeof organization==='string')params.set('scope','ORGANIZATION');
 return `/${locale}/vat?${params}`;
}
