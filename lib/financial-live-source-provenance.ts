import type {RecognitionEvent} from './financial-event-ledger';

/**
 * Structural integrity of normalization emitted by the Production reporting
 * RPC. This runs on the LIVE statement path; it does NOT independently
 * confirm original database amounts, source inclusion, approved policy or RLS.
 * Independent source verification remains a separate release blocker.
 */
const UUID='[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const canonicalId=new RegExp('^'+UUID+'$','i');
const derived=new RegExp('^('+UUID+'):([A-Z][A-Z0-9_]{0,63})$','i');
const refund=new RegExp('^('+UUID+'):refund:('+UUID+')$','i');
const flow=new RegExp('^(flow|transfer):('+UUID+')$','i');
const tx=new RegExp('^transaction:('+UUID+')$','i');
const sourceAmount=/^\d{1,20}(\.\d{1,4})?$/;

type Event=Pick<RecognitionEvent,'id'|'sourceModule'|'sourceKey'|'lines'>;
function invalid():never{throw Error('REPORTING_SOURCE_PROVENANCE_INVALID')}
export function assertNormalizedLiveEventProvenance(events:readonly Event[]){
 const eventIds=new Set<string>(),lineIds=new Set<string>();
 // One database financial_event_lines UUID may split into VAT components,
 // but it cannot belong to a second event with a different accounting role.
 const originalOwners=new Map<string,string>();
 for(const e of events){
  if(!e.id||eventIds.has(e.id)||!e.sourceKey)invalid();
  eventIds.add(e.id);
  if(e.sourceModule==='LEGACY_CASH'){
   const match=e.id.match(flow);
   if(!match||e.sourceKey.toLowerCase()!==match[2].toLowerCase()||
    e.lines.length!==1||e.lines[0].id!==e.id||
    e.lines[0].recognitionSign!==1)invalid();
   // Standalone flow classifications end in :CASH. Transfers have a single
   // FX net-difference part, never a duplicated cash leg or regular category.
   if(match[1].toLowerCase()==='transfer'){
    if(e.lines[0].classificationId!=='TRANSFER_DIFFERENCE:CASH')invalid();
   }else if(!e.lines[0].classificationId.endsWith(':CASH'))invalid();
  }else if(e.sourceModule==='LEGACY_ASSET'){
   const match=e.id.match(tx);
   if(!match||match[1].toLowerCase()!==e.sourceKey.toLowerCase()||
    !e.lines.length||e.lines.length>2)invalid();
   const roles=new Set<string>();
   let sale=false;
   let bookClassification:string|undefined,proceedsClassification:string|undefined;
   for(const l of e.lines){
    const prefix=e.id+':';
    if(!l.id.startsWith(prefix)||l.cashDirection!=='NON_CASH'||
      l.recognitionSign!==1)invalid();
    const role=l.id.slice(prefix.length);
    if(!['BOOK','PROCEEDS'].includes(role)||roles.has(role))invalid();
    roles.add(role);
    if(role==='PROCEEDS'){
     if(!l.classificationId.endsWith(':SALE:PROCEEDS')||
       l.classificationId.split(':').length<3)invalid();
     proceedsClassification=l.classificationId;
     sale=true;
    }else{
     const parts=l.classificationId.split(':');
     if(parts.length<4||parts.at(-1)!=='BOOK'||!parts.at(-2)||!parts.at(-3))invalid();
     bookClassification=l.classificationId;
     if(/:SALE:.+:BOOK$/.test(l.classificationId))sale=true;
    }
   }
   // SALE must ALWAYS contain PROCEEDS, even if book cost is zero. A
   // non-sale must NEVER contain PROCEEDS. A zero-cost SALE may contain
   // only PROCEEDS, but a non-sale always has its one BOOK component.
   if((sale&&!roles.has('PROCEEDS'))||(!sale&&
     (roles.size!==1||!roles.has('BOOK'))))invalid();
   if(sale&&bookClassification&&proceedsClassification){
    const prefix=proceedsClassification.slice(0,-':SALE:PROCEEDS'.length);
    if(!bookClassification.startsWith(prefix+':SALE:')||
      !bookClassification.endsWith(':BOOK'))invalid();
   }
  }else{
   // All Financial Core normalized events have UUID event IDs. Synthetic
   // VAT note obligations are *not* financial_event_lines records.
   if(!canonicalId.test(e.id)||!e.lines.length)invalid();
   const originalParts=new Map<string,Set<string>>();
   for(const l of e.lines){
    const extra=l.id.match(refund);
    if(extra){
     if(extra[1].toLowerCase()!==e.id.toLowerCase()||
      !l.classificationId.startsWith('VAT_NOTE_REFUND_')||
      l.cashDirection!=='NON_CASH')invalid();
     continue;
    }
    const part=l.id.match(derived);
    const cls=l.classificationId.match(derived);
    if(!part||!cls||part[2]!==cls[2])invalid();
    const owner=originalOwners.get(part[1].toLowerCase());
    if(owner&&owner!==e.id.toLowerCase())invalid();
    originalOwners.set(part[1].toLowerCase(),e.id.toLowerCase());
    const prior=originalParts.get(part[1])??new Set<string>();
    if(prior.has(part[2]))invalid();
    prior.add(part[2]);originalParts.set(part[1],prior);
   }
   for(const roles of originalParts.values()){
    if([...roles].some(r=>r.startsWith('INPUT_VAT_'))){
     if([...roles].some(r=>!['INPUT_VAT_RECOVERABLE','INPUT_VAT_NONRECOVERABLE'].includes(r)))invalid();
    }else if(roles.size!==1)invalid();
   }
  }
  for(const l of e.lines){
   if(!l.id||!l.classificationId||lineIds.has(l.id)||
    !sourceAmount.test(l.baseAmount)||Number(l.baseAmount)<=0||
    !['NON_CASH','INFLOW','OUTFLOW'].includes(l.cashDirection)||
    ![1,-1].includes(l.recognitionSign))invalid();
   lineIds.add(l.id);
  }
 }
}
