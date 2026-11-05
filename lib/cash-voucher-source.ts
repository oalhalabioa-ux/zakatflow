type Detail={event:{id:string;organization_id:string;source_module:string;source_record_id:string|null;event_date:string};financial_event_links?:Array<{target_module?:string;target_record_id?:string;related_event_id?:string}>};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function cashVoucherSourceLinks(d:Detail,locale:string){
 const lang=locale==='ar'?'ar':'en',org=d.event.organization_id,q='scope=ORGANIZATION&level=COMPANY&organization='+encodeURIComponent(org),links=new Map<string,{href:string;kind:string}>();
 function add(table:string|undefined,id:string|undefined|null){if(!id||!uuid.test(id))return;let href='',kind='';
  if(table==='debt_contracts'){href=`/${lang}/loans?${q}&contract_id=${id}`;kind='LOAN'}
  if(table==='transactions'){href=`/${lang}/transactions?${q}&transaction_id=${id}`;kind='ASSET'}
  if(table==='investment_contracts'){href=`/${lang}/investments?${q}&investment_id=${id}`;kind='INVESTMENT'}
  if(table==='vat_documents'){const month=d.event.event_date.slice(0,7);href=`/${lang}/vat?section=invoices&organization_id=${encodeURIComponent(org)}&document_id=${id}&month=${encodeURIComponent(month)}`;kind='INVOICE'}
  if(table==='financial_events'&&id!==d.event.id){href=`/${lang}/cash-vouchers/${id}?organization=${encodeURIComponent(org)}`;kind='VOUCHER'}
  if(href)links.set(href,{href,kind});
 }
 const modules:Record<string,string>={DEBT_CONTRACTS:'debt_contracts',DEBT_FUNDING:'debt_contracts',DEBT_LINK:'debt_contracts',VAT_INTEGRATION:'vat_documents'};
 add(modules[d.event.source_module],d.event.source_record_id);
 for(const l of d.financial_event_links??[]){add(l.target_module,l.target_record_id);add('financial_events',l.related_event_id)}
 return [...links.values()];
}
