import {requireUser} from './auth';
import {openingScope,openingCommand,type OpeningWorkspaceData} from '../lib/financial-opening-workspace';
export function assertOpeningWorkspace(){
 if(process.env.FINANCIAL_OPENING_WORKSPACE!=='true')throw Error('OPENING_DISABLED');
}
function unwrap<T>(r:{data:T;error:{message:string}|null}){if(r.error){const code=r.error.message.match(/(?:OPENING|FISCAL)_[A-Z_]+/)?.[0];throw Error(code??'OPENING_UNAVAILABLE')}return r.data}
export async function openingContext(){
 assertOpeningWorkspace();const{supabase,user}=await requireUser();
 const memberships=unwrap(await supabase.from('organization_members').select('organization_id').eq('user_id',user.id).eq('status','ACTIVE'))??[];
 const permitted:string[]=[];for(const m of memberships){if(unwrap(await supabase.rpc('financial_core_can',{p_org:m.organization_id,p_scope:'financial_core.view'}))===true)permitted.push(m.organization_id)}
 if(!permitted.length)return [];
 const organizations=unwrap(await supabase.from('organizations').select('id,name,base_currency').in('id',permitted).order('name'))??[];
 return Promise.all(organizations.map(async org=>{
  const context=unwrap(await supabase.rpc('financial_fiscal_context',{p_org:org.id}));
  return {...org,currentFiscalStart:context?.period?.start??null};
 }));
}
export async function readOpening(input:unknown):Promise<OpeningWorkspaceData>{
 assertOpeningWorkspace();const q=openingScope.parse(input),{supabase}=await requireUser();
 const workspace:OpeningWorkspaceData=unwrap(await supabase.rpc('financial_opening_workspace',{p_org:q.organization,p_fiscal_start:q.fiscalStart}));
 if(workspace.workspace?.status!=='DRAFT'||!workspace.canSave)return workspace;
 const approved=unwrap(await supabase.from('financial_opening_workspaces').select('id')
  .eq('organization_id',q.organization).eq('fiscal_start',q.fiscalStart).eq('status','APPROVED').limit(1));
 return {...workspace,replacesApproved:Boolean(approved?.length)};
}
export async function writeOpening(input:unknown){
 assertOpeningWorkspace();const q=openingCommand.parse(input),{supabase}=await requireUser();
 if(q.action==='approve')return unwrap(await supabase.rpc('approve_financial_opening',{p_id:q.id,p_expected_version:q.expectedVersion}));
 return unwrap(await supabase.rpc('save_financial_opening',{p_org:q.organization,p_fiscal_start:q.fiscalStart,p_expected_version:q.expectedVersion,p_source_revision:q.sourceRevision,p_entries:q.entries,p_reason:q.reason}));
}
