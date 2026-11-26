/** Old register bookmarks point at the same institution in the unified VAT page. */
export function invoiceRegisterHref(locale:string,query:Record<string,string|string[]|undefined>){
 const params=new URLSearchParams({section:'unified',scope:'ORGANIZATION'});
 for(const [key,value] of Object.entries(query))if(typeof value==='string'&&!['section','scope','organization_id'].includes(key))params.set(key,value);
 const organization=query.organization??query.organization_id;
 if(typeof organization==='string')params.set('organization',organization);
 return `/${locale}/vat?${params}`;
}
