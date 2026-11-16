import Decimal from 'decimal.js';
import {requireUser} from './auth';
import type {CanonicalLineageJournal} from './financial-branch-journal-source';

const Money=Decimal.clone({precision:50});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const synthetic=/^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}):refund:([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
const sourceAmount=/^\d{1,20}(\.\d{1,4})?$/;
type Refund={id:string;event_id:string;organization_id:string;obligation_key:string;obligation_type:string;settleable_base_amount:string|number};
type Reversal={event_id:string;organization_id:string;link_type:string;related_event_id:string|null};
type Original={id:string;organization_id:string};

/** These are event-level synthetic VAT note obligations, NOT financial_event_lines.
 * The Production normalization RPC selects all positive note-refund obligations
 * against the event itself, or its REVERSAL_OF original, and negates the
 * reversal's synthetic recognitionSign.
 *
 * Evidence is confined to a single authorized legal company; it does NOT
 * attest cash flows, ordinary reversal line signs, or one atomic DB revision.
 */
export async function observeVatRefundSources(
 organizationId:string,journals:readonly CanonicalLineageJournal[],
):Promise<{status:'RLS_MATCHED_SYNTHETIC_REFUND_SOURCES_ONLY';organizationId:string;
 eventsObserved:number;refundPartsMatched:number;refundReversalSignsMatched:boolean}>{
 if(!uuid.test(organizationId)||journals.length>10000)
  throw Error('REPORTING_REFUND_SOURCE_INVALID');
 const seen=new Set<string>();
 for(const j of journals){
  if(!uuid.test(j.id)||j.organizationId!==organizationId||j.status!=='POSTED'||
   !Array.isArray(j.sourceLines)||seen.has(j.id))
   throw Error('REPORTING_REFUND_SOURCE_INVALID');
  seen.add(j.id);
 }
 if(!journals.length)return{status:'RLS_MATCHED_SYNTHETIC_REFUND_SOURCES_ONLY',
  organizationId,eventsObserved:0,refundPartsMatched:0,refundReversalSignsMatched:true};
 const {supabase,user}=await requireUser();
 const authorize=async()=>{
  const member=await supabase.from('organization_members').select('organization_id')
   .eq('organization_id',organizationId).eq('user_id',user.id).eq('status','ACTIVE').maybeSingle();
  if(member.error||!member.data)throw Error('REPORTING_REFUND_ACCESS_DENIED');
  const permission=await supabase.rpc('financial_core_can',{p_org:organizationId,p_scope:'financial_core.view'});
  if(permission.error||permission.data!==true)throw Error('REPORTING_REFUND_ACCESS_DENIED');
 };
 await authorize();
 let matched=0;
 for(let offset=0;offset<journals.length;offset+=100){
  const batch=journals.slice(offset,offset+100);
  const ids=batch.map(j=>j.id);
  const sourceLinks=await supabase.from('financial_event_links')
   .select('event_id,organization_id,link_type,related_event_id')
   .eq('organization_id',organizationId).eq('link_type','REVERSAL_OF')
   .in('event_id',ids).limit(ids.length+1);
  if(sourceLinks.error||!Array.isArray(sourceLinks.data))
   throw Error('REPORTING_REFUND_SOURCE_UNAVAILABLE');
  if(sourceLinks.data.length>ids.length)
   throw Error('REPORTING_REFUND_SOURCE_INCOMPLETE');
  const reversal=new Map<string,string>(),scope=new Set(ids);
  for(const link of sourceLinks.data as Reversal[]){
   if(link.organization_id!==organizationId||link.link_type!=='REVERSAL_OF'||
    !scope.has(link.event_id)||!uuid.test(link.related_event_id??'')||
    link.related_event_id===link.event_id||reversal.has(link.event_id))
    throw Error('REPORTING_REFUND_SOURCE_INCOMPLETE');
   reversal.set(link.event_id,link.related_event_id!);
  }
  const originals=[...new Set(reversal.values())];
  if(originals.length){
   const originalRows=await supabase.from('financial_events')
    .select('id,organization_id').eq('organization_id',organizationId)
    .in('id',originals).limit(originals.length+1);
   if(originalRows.error||!Array.isArray(originalRows.data)||
    originalRows.data.length!==originals.length||
    new Set((originalRows.data as Original[]).map(r=>r.id)).size!==originals.length||
    (originalRows.data as Original[]).some(r=>r.organization_id!==organizationId||!originals.includes(r.id)))
    throw Error('REPORTING_REFUND_SOURCE_INCOMPLETE');
  }
  const rootIds=[...new Set(ids.map(id=>reversal.get(id)??id))];
  // The server RPC uses obligation_key = 'note-refund' AND strictly positive
  // settleable_base_amount. A capped read MUST reject a full cap to avoid
  // silently accepting a truncated list.
  const response=await supabase.from('financial_event_obligations')
   .select('id,event_id,organization_id,obligation_key,obligation_type,settleable_base_amount')
   .eq('organization_id',organizationId).eq('obligation_key','note-refund')
   .gt('settleable_base_amount',0).in('event_id',rootIds).limit(401);
  if(response.error||!Array.isArray(response.data)||response.data.length>=401)
   throw Error('REPORTING_REFUND_SOURCE_UNAVAILABLE');
  const byRoot=new Map<string,Refund[]>(),recordIds=new Set<string>();
  for(const refund of response.data as Refund[]){
   if(refund.organization_id!==organizationId||!uuid.test(refund.id)||
    !rootIds.includes(refund.event_id)||refund.obligation_key!=='note-refund'||
    !new Money(refund.settleable_base_amount).isFinite()||
    !new Money(refund.settleable_base_amount).gt(0)||recordIds.has(refund.id))
    throw Error('REPORTING_REFUND_SOURCE_INCOMPLETE');
   recordIds.add(refund.id);
   byRoot.set(refund.event_id,[...(byRoot.get(refund.event_id)??[]),refund]);
  }
  for(const journal of batch){
   const root=reversal.get(journal.id)??journal.id,required=byRoot.get(root)??[];
   const lines=journal.sourceLines.filter(l=>l.id.includes(':refund:'));
   if(lines.length!==required.length)throw Error('REPORTING_REFUND_SOURCE_INCOMPLETE');
   const expected=new Map(required.map(r=>[journal.id+':refund:'+r.id,r]));
   for(const line of lines){
    const match=line.id.match(synthetic);
    const source=expected.get(line.id);
    const amount=source&&new Money(source.settleable_base_amount);
    if(!match||match[1].toLowerCase()!==journal.id.toLowerCase()||
     !source||!amount||!sourceAmount.test(line.baseAmount)||
     !amount.toDecimalPlaces(4,Money.ROUND_HALF_UP).eq(line.baseAmount)||line.classificationId!=='VAT_NOTE_REFUND_'+source.obligation_type||
     line.cashDirection!=='NON_CASH'||
     line.recognitionSign!==(reversal.has(journal.id)?-1:1))
     throw Error('REPORTING_REFUND_SOURCE_MISMATCH');
    expected.delete(line.id);
    matched++;
   }
   if(expected.size)throw Error('REPORTING_REFUND_SOURCE_INCOMPLETE');
  }
 }
 await authorize();
 return{status:'RLS_MATCHED_SYNTHETIC_REFUND_SOURCES_ONLY',
  organizationId,eventsObserved:journals.length,
  refundPartsMatched:matched,refundReversalSignsMatched:true};
}
