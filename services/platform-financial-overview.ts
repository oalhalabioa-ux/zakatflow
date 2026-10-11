import {requireUser} from './auth';
import {listBudgetPlans,getBudgetPlan} from './budget-planning';
import {buildBudgetMetrics} from '@/lib/budget-planning';
import {platformLiquiditySummary} from '@/lib/platform-liquidity-summary';
import {GET as readVat} from '@/app/api/vat/route';
import {GET as readLiquidity} from '@/app/api/liquidity/route';

// Reuse the authenticated module read handlers in-process. No HTTP loop, writes,
// service-role access, cross-company sums or new financial recognition rules.
export async function getPlatformFinancialOverview(q:{organization?:string;plan?:string;month?:string}) {
  const {supabase,user}=await requireUser();
  const [members,plans]=await Promise.all([
    supabase.from('organization_members').select('organization_id').eq('user_id',user.id).eq('status','ACTIVE'),
    listBudgetPlans(),
  ]);
  if(members.error)throw members.error;
  const ids=(members.data??[]).map(m=>m.organization_id);
  const orgs=ids.length?await supabase.from('organizations').select('id,name,base_currency,organization_kind').in('id',ids).order('name'):{data:[],error:null};
  if(orgs.error)throw orgs.error;
  const organizations=orgs.data??[];
  if(q.organization&&!organizations.some(o=>o.id===q.organization))throw new Error('ORGANIZATION_ACCESS_REQUIRED');
  const organization=organizations.find(o=>o.id===q.organization)??organizations.find(o=>o.organization_kind==='HOLDING')??organizations[0]??null;
  const availablePlans=(plans??[]).filter(p=>p.status!=='ARCHIVED');
  if(q.plan&&!availablePlans.some(p=>p.id===q.plan))throw new Error('BUDGET_PLAN_ACCESS_REQUIRED');
  const selectedPlan=availablePlans.find(p=>p.id===q.plan)??availablePlans.find(p=>p.organization_name===organization?.name)??availablePlans[0]??null;
  const today=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Riyadh'});
  const month=/^\d{4}-(0[1-9]|1[0-2])$/.test(q.month??'')?q.month!:today.slice(0,7);
  async function read(handler:(req:Request)=>Promise<Response>,path:string) {
    try {const response=await handler(new Request(`https://zakatflow.local${path}`));return response.ok?await response.json():null;}catch{return null;}
  }
  const [vat,cash,plan]=await Promise.all([
    organization?read(readVat,`/api/vat?organization_id=${organization.id}&period_month=${month}`):null,
    organization?read(readLiquidity,`/api/liquidity?organization_id=${organization.id}`):null,
    selectedPlan?getBudgetPlan(selectedPlan.id).catch(()=>null):null,
  ]);
  return {organizations,organization,plans:availablePlans,selectedPlan,month,today,
    vat:vat?{totals:vat.periodTotals,period:vat.period,profileConfigured:!!vat.profile}:null,
    cash:cash?platformLiquiditySummary(cash,today):null,
    budget:plan?{metrics:buildBudgetMetrics(plan),plan}:null};
}
