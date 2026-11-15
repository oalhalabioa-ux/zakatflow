import {requireUser} from './auth';
import {groupOpenItemEvidenceSchema,type GroupOpenItemEvidence} from '../lib/financial-group-open-items';
import type {SourceBoundAdjustment} from '../lib/financial-group-source-bound-adjustments';
/** RLS reads only the selected documents and their real notes/applications.
 * Exact counts/pagination prevent a truncated allocation list becoming a larger
 * apparent outstanding balance. Numeric amounts are requested as decimal text. */
export async function readGroupOpenItems(entries:readonly SourceBoundAdjustment[]){
 const {supabase,user}=await requireUser(),requests=new Map<string,Set<string>>();
 for(const e of entries.filter(e=>e.kind==='INTERCOMPANY_BALANCE'))for(const ref of [e.debitSource,e.creditSource]){
  const ids=requests.get(ref.organizationId)??new Set<string>();ids.add(ref.eventId);requests.set(ref.organizationId,ids);
 }
 const result:GroupOpenItemEvidence[]=[];
 for(const [organization,ids] of requests){
  async function authorize(){
   const m=await supabase.from('organization_members').select('organization_id').eq('organization_id',organization).eq('user_id',user.id).eq('status','ACTIVE').maybeSingle();
   const p=await supabase.rpc('financial_core_can',{p_org:organization,p_scope:'financial_core.view'});
   if(m.error||!m.data||p.error||p.data!==true)throw Error('REPORTING_ACCESS_DENIED');
  }
  await authorize();
  async function read(table:string,columns:string,column:string,values:string[],rootOnly=false,reversalOnly=false){
   const rows:unknown[]=[];
   for(let offset=0;offset<values.length;offset+=100){
    const batch=values.slice(offset,offset+100);let expected:number|undefined;
    for(let start=0;;start+=500){
     let q=supabase.from(table).select(columns,{count:'exact'}).eq('organization_id',organization).in(column,batch).order('id').range(start,start+499);
     if(rootOnly)q=q.is('adjusts_obligation_id',null);if(reversalOnly)q=q.eq('link_type','REVERSAL_OF');
     const r=await q;
     if(r.error||!Array.isArray(r.data)||r.count===null||r.count>10000||(expected!==undefined&&expected!==r.count)||r.data.length!==Math.min(500,Math.max(0,r.count-start)))throw Error('REPORTING_GROUP_OPEN_ITEMS_UNAVAILABLE');
     expected=r.count;rows.push(...r.data);if(rows.length>10000)throw Error('REPORTING_GROUP_OPEN_ITEMS_UNAVAILABLE');if(start+r.data.length===expected)break;
    }
   }
   return rows as Record<string,string|null>[];
  }
  const columns='id,organization_id,event_id,obligation_type,adjusts_obligation_id,adjustment_effect,base_currency,settleable_base_amount::text';
  const roots=await read('financial_event_obligations',columns,'event_id',[...ids],true);
  const rootIds=roots.map(r=>r.id!);
  const notes=await read('financial_event_obligations',columns,'adjusts_obligation_id',rootIds);
  const allocations=await read('financial_event_obligation_allocations','id,organization_id,application_event_id,obligation_id,base_currency,base_amount::text','obligation_id',rootIds);
  const eventIds=[...new Set([...roots,...notes].map(r=>r.event_id!).concat(allocations.map(a=>a.application_event_id!)))];
  const reversals=await read('financial_event_links','id,organization_id,event_id,related_event_id','related_event_id',eventIds,false,true);
  const allIds=[...new Set([...eventIds,...reversals.map(r=>r.event_id!)])];
  const events=await read('financial_events','id,organization_id,event_date,status,base_currency','id',allIds);
  if(events.length!==allIds.length)throw Error('REPORTING_GROUP_OPEN_ITEMS_UNAVAILABLE');
  const parsed=groupOpenItemEvidenceSchema.safeParse({organizationId:organization,roots,notes,allocations,events,reversals});
  if(!parsed.success)throw Error('REPORTING_GROUP_OPEN_ITEMS_INVALID');
  await authorize();result.push(parsed.data);
 }
 return result;
}
