import {z} from 'zod';
import {requireUser} from './auth';
import {assertOpeningWorkspace} from './financial-opening-workspace';
import {retainedAccountCandidates,type FiscalManagementContext,type FiscalReference} from '../lib/financial-fiscal-years';

function unwrap<T>(r:{data:T;error:{message:string}|null}):T{
 if(r.error)throw Error(/FISCAL_[A-Z_]+/.exec(r.error.message)?.[0]??'FISCAL_UNAVAILABLE');
 return r.data;
}
/** Metadata only, through the caller's RLS client; no privileged client or writes. */
export async function fiscalManagementContext(organization:unknown):Promise<FiscalManagementContext>{
 assertOpeningWorkspace();const org=z.string().uuid().parse(organization),{supabase}=await requireUser();
 const context=unwrap(await supabase.rpc('financial_fiscal_context',{p_org:org}));
 const [openings,policies,budgets,assignments,postingAccounts]=await Promise.all([
  supabase.from('financial_opening_workspaces').select('fiscal_start,status').eq('organization_id',org),
  supabase.from('financial_reporting_policies').select('fiscal_start,status').eq('organization_id',org),
  supabase.from('financial_budget_plan_ownership').select('fiscal_start').eq('organization_id',org),
  supabase.from('financial_opening_source_assignments').select('fiscal_start').eq('organization_id',org),
  supabase.rpc('financial_chart_posting_accounts',{p_org:org}),
 ]);
 const references:FiscalReference[]=[
  ...(unwrap(assignments)??[]).map(r=>({start:r.fiscal_start,source:'assignment' as const})),
  ...(unwrap(openings)??[]).map(r=>({start:r.fiscal_start,source:'opening' as const,status:r.status})),
  ...(unwrap(policies)??[]).map(r=>({start:r.fiscal_start,source:'policy' as const,status:r.status})),
  ...(unwrap(budgets)??[]).map(r=>({start:r.fiscal_start,source:'budget' as const})),
 ];
 // A membership revoked while the metadata was loading must not return stale data.
 unwrap(await supabase.rpc('financial_fiscal_context',{p_org:org}));
 return {...context,references,retainedCandidates:retainedAccountCandidates(unwrap(postingAccounts)),asOf:new Date().toISOString().slice(0,10)};
}
