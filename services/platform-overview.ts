import {requireUser} from './auth';

// Counts only: organizational cash, VAT and budgets must not be combined across
// entities/currencies or reconstructed outside their established report engines.
export async function getPlatformOverview(organizationId?:string,organizationName?:string,reportIds?:string[]) {
  const {supabase,user}=await requireUser();
  const {data:members,error}=await supabase.from('organization_members')
    .select('organization_id').eq('user_id',user.id).eq('status','ACTIVE');
  const ids=Array.from(new Set((members??[]).map(x=>x.organization_id))).filter(id=>reportIds?reportIds.includes(id):!organizationId||id===organizationId);
  if(organizationId&&(!ids.includes(organizationId)||reportIds?.some(id=>!ids.includes(id))))throw new Error("ORGANIZATION_ACCESS_REQUIRED");
  async function count(query:PromiseLike<{count:number|null;error:unknown}>) {
    try {const r=await query;return r.error?null:r.count??0;}catch{return null;}
  }
  const orgCount=(table:string,active=false)=>error?Promise.resolve(null):!ids.length?Promise.resolve(0):count(
    active?supabase.from(table).select('id',{count:'exact',head:true}).in('organization_id',ids).eq('active',true)
      :supabase.from(table).select('id',{count:'exact',head:true}).in('organization_id',ids));
  const [taxDocuments,eInvoices,cashAccounts,cashFlows,parties,budgetPlans,approvedPlans]=await Promise.all([
    orgCount('vat_documents'),orgCount('vat_einvoices'),orgCount('liquidity_accounts',true),orgCount('liquidity_flows'),orgCount('liquidity_counterparties'),
    count(organizationName?supabase.from('budget_plans').select('id',{count:'exact',head:true}).eq('user_id',user.id).eq('organization_name',organizationName):supabase.from('budget_plans').select('id',{count:'exact',head:true}).eq('user_id',user.id)),
    count(organizationName?supabase.from('budget_plans').select('id',{count:'exact',head:true}).eq('user_id',user.id).eq('organization_name',organizationName).eq('status','APPROVED'):supabase.from('budget_plans').select('id',{count:'exact',head:true}).eq('user_id',user.id).eq('status','APPROVED')),
  ]);
  return {organizations:error?null:ids.length,taxDocuments,eInvoices,cashAccounts,cashFlows,parties,budgetPlans,approvedPlans};
}
