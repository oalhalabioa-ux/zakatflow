import {NextResponse} from 'next/server';
import {z} from 'zod';
import {requireUser} from '../../../../services/auth';
import {requireOrganizationMember} from '../../../../services/organization-access';
import {buildReportMovements,type ReportInvoice} from '../../../../lib/vat-financial-reports';
import {assetPurchaseInvoices} from '../../../../lib/asset-invoice-source';
const headers={'Cache-Control':'no-store'};
// Fail closed rather than return silently truncated financial reports.
async function all(query:()=>any,orderBy:string[]=['id']):Promise<any[]>{const rows:any[]=[];for(let offset=0;offset<50000;offset+=500){let page=query();for(const key of orderBy)page=page.order(key);const r=await page.range(offset,offset+499);if(r.error)throw r.error;rows.push(...r.data);if(r.data.length<500)return rows;}throw new Error('REPORT_TOO_LARGE');}
export async function GET(request:Request){try{
 const {supabase,user}=await requireUser();const p=new URL(request.url).searchParams;
 const parsed=z.object({ids:z.array(z.string().uuid()).min(1).max(50),to:z.string().date()}).safeParse({ids:[...new Set((p.get('organization_ids')||'').split(','))],to:p.get('to')});
 if(!parsed.success)return NextResponse.json({error:'INVALID_REPORT_QUERY'},{status:400,headers});
 const {ids,to}=parsed.data;for(const id of ids)await requireOrganizationMember(supabase,user.id,id);
 const [events,obligations,allocations,parties,documents,organizations,lines,classifications,bindings,links,transactions]=await Promise.all([
  all(()=>supabase.from('financial_events').select('id,organization_id,counterparty_id,event_date,due_date,status,description,source_record_id,source_module').in('organization_id',ids).lte('event_date',to)),
  all(()=>supabase.from('financial_event_obligations').select('*').in('organization_id',ids)),
  all(()=>supabase.from('financial_event_obligation_allocations').select('*').in('organization_id',ids)),
  all(()=>supabase.from('liquidity_counterparties').select('id,organization_id,name').in('organization_id',ids)),
  all(()=>supabase.from('vat_documents').select('id,organization_id,asset_transaction_id,document_number,document_type,document_kind,transaction_date,counterparty_name,net_amount,tax_amount,gross_amount,currency').in('organization_id',ids).lte('transaction_date',to)),
  all(()=>supabase.from('organizations').select('id,name').in('id',ids)),
  all(()=>supabase.from('financial_event_lines').select('id,event_id,organization_id,classification_id,base_amount,cash_direction,metadata').in('organization_id',ids)),
  all(()=>supabase.from('financial_classifications').select('id,classification_type').in('organization_id',ids)),
  all(()=>supabase.from('financial_vat_source_bindings').select('organization_id,event_id,source_record_id,source_table').in('organization_id',ids).eq('source_table','vat_documents'),['organization_id','source_record_id']),
  all(()=>supabase.from('financial_event_links').select('id,organization_id,event_id,target_record_id').in('organization_id',ids).eq('target_module','vat_documents').eq('link_type','SOURCE')),
  all(()=>supabase.from('transactions').select('id,organization_id,asset_account_id,transaction_type,transaction_date,reference,currency,base_currency,gross_value,base_value,metadata,reversal_of_transaction_id').in('organization_id',ids).eq('transaction_type','PURCHASE').lte('transaction_date',to)),
 ]);
 const assetInvoices=assetPurchaseInvoices(transactions,events,parties,documents);
 const byEvent=new Map(events.filter(e=>e.status==='ACTUAL').map(e=>[e.id,e]));
 const bySource=new Map(events.filter(e=>e.status==='ACTUAL'&&e.source_record_id).map(e=>[`${e.organization_id}:${e.source_record_id}`,e]));
 for(const link of [...links.map(l=>({...l,source_record_id:l.target_record_id})),...bindings]){const event=byEvent.get(link.event_id);if(event&&event.organization_id===link.organization_id)bySource.set(`${link.organization_id}:${link.source_record_id}`,event);}
 const references=new Map<string,string>(documents.map(d=>[d.id,d.document_number]));
 const sourceSides=new Map<string,'SALES'|'PURCHASE'>(documents.map(d=>[d.id,d.document_type]));
 const partyNames=[...parties];
 for(const d of documents){const e=bySource.get(`${d.organization_id}:${d.id}`);if(!e)continue;if(e.source_record_id){references.set(e.source_record_id,d.document_number);sourceSides.set(e.source_record_id,d.document_type);}if(!e.counterparty_id)partyNames.push({id:'unmapped:'+e.id,organization_id:e.organization_id,name:d.counterparty_name||'—'});}
 for(const a of assetInvoices){references.set(a.id,a.reference);sourceSides.set(a.id,'PURCHASE');}
 const movements=buildReportMovements(events,obligations,allocations,partyNames,references,sourceSides);
 const cls=new Map(classifications.map(c=>[c.id,c.classification_type]));
 const linesByEvent=new Map<string,any[]>();for(const line of lines){const group=linesByEvent.get(line.event_id)||[];group.push(line);linesByEvent.set(line.event_id,group);}
 const invoices:ReportInvoice[]=documents.flatMap(d=>{const e=bySource.get(`${d.organization_id}:${d.id}`);if(!e)return [];const sign=d.document_kind==='CREDIT_NOTE'?-1:1;
  const kinds=[...new Set((linesByEvent.get(e.id)||[]).filter(l=>(l.metadata?.source_role==='NET_RECOGNITION'||(!l.metadata?.source_role&&l.cash_direction==='NON_CASH'&&cls.get(l.classification_id)!=='TAX'))).map(l=>cls.get(l.classification_id)||'UNCLASSIFIED'))];
  return [{source:d.asset_transaction_id?'ASSETS':'INVOICING',id:d.id,organizationId:d.organization_id,partyKey:`${d.organization_id}:${e.counterparty_id||'unmapped:'+e.id}`,partyName:d.counterparty_name,side:d.document_type,date:e.event_date,reference:d.document_number,currency:d.currency,net:Number(d.net_amount)*sign,tax:Number(d.tax_amount)*sign,total:Number(d.gross_amount)*sign,classification:kinds.join(' / ')||'UNCLASSIFIED'}];});
 const postedDocumentCount=invoices.length;
 for(const a of assetInvoices.filter(a=>a.accountingStatus==='ACTUAL')){const kinds=[...new Set((linesByEvent.get(a.eventId)||[]).filter(l=>l.cash_direction==='NON_CASH'&&cls.get(l.classification_id)!=='TAX').map(l=>cls.get(l.classification_id)||'UNCLASSIFIED'))];invoices.push({id:'asset:'+a.id,source:'ASSETS',organizationId:a.organizationId,partyKey:`${a.organizationId}:${a.partyId}`,partyName:a.partyName,side:'PURCHASE',date:a.date,reference:a.reference,currency:a.baseCurrency,net:a.baseNet,tax:a.baseTax,total:a.baseTotal,classification:kinds.join(' / ')||'UNCLASSIFIED'});}
 return NextResponse.json({movements,invoices,organizations,unposted:documents.length-postedDocumentCount+assetInvoices.filter(a=>a.accountingStatus!=='ACTUAL').length},{headers});
 }catch(e){const code=e instanceof Error?e.message:'';return NextResponse.json({error:code==='REPORT_TOO_LARGE'?code:'REPORT_LOAD_FAILED'},{status:code==='UNAUTHORIZED'?401:code==='ORGANIZATION_ACCESS_REQUIRED'?403:500,headers});}}
