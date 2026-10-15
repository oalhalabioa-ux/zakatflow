export function dashboardScopeHref(locale:string,query:Record<string,string|undefined>,organization:string,group:boolean){
 const params=new URLSearchParams();
 for(const key of ['plan','month','budget_scope','year','scenario','asset_basis'])if(query[key])params.set(key,query[key]!);
 params.set('scope','ORGANIZATION');params.set('organization',organization);params.set('level',group?'GROUP':'COMPANY');
 if(group&&params.get('budget_scope')==='PLAN')params.delete('budget_scope');
 return `/${locale}/dashboard?${params}`;
}
