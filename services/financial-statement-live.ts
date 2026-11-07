import {requireUser} from './auth';
import {assertOpeningWorkspace,openingContext} from './financial-opening-workspace';
import {normalizeStatementSource,statementQuery} from '../lib/financial-statement-source';
import {endingForFiscalStart} from '../lib/financial-fiscal-end';
export function assertLiveStatements(){assertOpeningWorkspace();if(process.env.FINANCIAL_STATEMENTS_LIVE!=='true')throw Error('REPORTING_DISABLED')}
function read<T>(r:{data:T;error:{message:string}|null}){if(r.error)throw Error(r.error.message.match(/REPORTING_[A-Z_]+/)?.[0]??'REPORTING_UNAVAILABLE');return r.data}
export async function liveStatementContext(){
 assertLiveStatements();
 const {supabase}=await requireUser();
 const periods=read(await supabase.rpc('financial_statement_live_context')) as {organizationId:string;name:string;currency:string;fiscalStart:string;fiscalEnd:string}[];
 const organizations=await openingContext();
 // The topbar's existing company/group switch uses the hierarchy of *authorized*
 // organizations. This relation controls only picker availability, never access
 // or financial consolidation; group reporting has a separate fail-closed gate.
 const permitted=new Set(organizations.map(org=>org.id));
 const hierarchy=organizations.length?read(await supabase.from('organizations')
  .select('id,parent_organization_id').in('id',[...permitted])) as {id:string;parent_organization_id:string|null}[]:[];
 const parents=new Map(hierarchy.map(row=>[row.id,permitted.has(row.parent_organization_id??'')?row.parent_organization_id:null]));
 return organizations.flatMap(org=>{
  const rows=periods.filter(period=>period.organizationId===org.id);
  const draftStart=org.currentFiscalStart??'';
  const current=draftStart&&!rows.some(period=>period.fiscalStart===draftStart)
   ?[{organizationId:org.id,name:org.name,currency:org.base_currency,fiscalStart:draftStart,fiscalEnd:endingForFiscalStart(draftStart)}]:[];
  const available=[...rows,...current].sort((a,b)=>b.fiscalStart.localeCompare(a.fiscalStart));
  return (available.length?available:[{organizationId:org.id,name:org.name,currency:org.base_currency,fiscalStart:'',fiscalEnd:''}])
   .map(period=>({...period,parentOrganizationId:parents.get(org.id)??null}));
 });
}
export async function liveStatementSource(input:unknown){
 assertLiveStatements();const q=statementQuery.parse(input),{supabase,user}=await requireUser();
 const args={p_org:q.organization,p_from:q.from,p_to:q.to};
 const primary=await supabase.rpc('financial_statement_live_snapshot',args);
 // A fresh legal entity may have no opening rows. Only a separate, trusted
 // database RPC may attest first activity from the COMPLETE historical source.
 // Never manufacture an empty opening in the browser or infer it from an RPC
 // error. Until the independently tested server RPC is installed, fail closed.
 const firstActivityAllowed=process.env.FINANCIAL_FIRST_ACTIVITY_REPORTING==='true'&&
  process.env.VERCEL_ENV!=='production';
 const raw=read(firstActivityAllowed&&primary.error?.message?.includes('REPORTING_APPROVED_OPENING_REQUIRED')
  ? await supabase.rpc('financial_statement_first_activity_snapshot',args)
  : primary);
 if(raw?.origin!=='LIVE_CANONICAL_EVENTS')throw Error('REPORTING_UNAVAILABLE');
 const result=normalizeStatementSource(raw,q);
 const membership=read(await supabase.from('organization_members').select('organization_id').eq('organization_id',q.organization).eq('user_id',user.id).eq('status','ACTIVE').maybeSingle());
 if(!membership||read(await supabase.rpc('financial_core_can',{p_org:q.organization,p_scope:'financial_core.view'}))!==true)throw Error('REPORTING_ACCESS_DENIED');
 return result;
}
