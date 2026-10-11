import Decimal from 'decimal.js';
import {listAssets} from './assets';
import {platformOrganizationTree} from '@/lib/platform-organization-tree';
import {requireUser} from './auth';
import {listBudgetPlans,getBudgetPlan} from './budget-planning';
import {buildBudgetMetrics} from '@/lib/budget-planning';
import {platformLiquiditySummary} from '@/lib/platform-liquidity-summary';
import {GET as readVat} from '@/app/api/vat/route';
import {GET as readLiquidity} from '@/app/api/liquidity/route';

// Reuse the authenticated module read handlers in-process. No HTTP loop, writes,
// service-role access, cross-company sums or new financial recognition rules.
export async function getPlatformFinancialOverview(q:{organization?:string;plan?:string;month?:string;scope?:string}) {
  const {supabase,user}=await requireUser();
  const institutional=q.scope==='ORGANIZATION';
  const [members,plans]=await Promise.all([
    supabase.from('organization_members').select('organization_id').eq('user_id',user.id).eq('status','ACTIVE'),
    institutional?listBudgetPlans():Promise.resolve([]),
  ]);
  if(members.error)throw members.error;
  const ids=(members.data??[]).map(m=>m.organization_id);
  const orgs=ids.length?await supabase.from('organizations').select('id,name,base_currency,organization_kind,parent_organization_id,sort_order').in('id',ids).order('name'):{data:[],error:null};
  if(orgs.error)throw orgs.error;
  const organizationTree=platformOrganizationTree(orgs.data??[]);
  const organizations=organizationTree.map(x=>x.organization);
  if(q.organization&&!organizations.some(o=>o.id===q.organization))throw new Error('ORGANIZATION_ACCESS_REQUIRED');
  const organization=organizations.find(o=>o.id===q.organization)??organizations.find(o=>o.organization_kind==='HOLDING')??organizations[0]??null;
  const availablePlans=(plans??[]).filter(p=>p.status!=='ARCHIVED');
  if(institutional&&q.plan&&!availablePlans.some(p=>p.id===q.plan))throw new Error('BUDGET_PLAN_ACCESS_REQUIRED');
  const selectedPlan=availablePlans.find(p=>p.id===q.plan&&p.organization_name===organization?.name)??availablePlans.find(p=>p.organization_name===organization?.name)??null;
  const today=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Riyadh'});
  const month=/^\d{4}-(0[1-9]|1[0-2])$/.test(q.month??'')?q.month!:today.slice(0,7);
  async function read(handler:(req:Request)=>Promise<Response>,path:string) {
    try {const response=await handler(new Request(`https://zakatflow.local${path}`));return response.ok?await response.json():null;}catch{return null;}
  }
  const [vat,cash,plan,assetRows]=await Promise.all([
    institutional&&organization?read(readVat,`/api/vat?organization_id=${organization.id}&period_month=${month}`):null,
    institutional&&organization?read(readLiquidity,`/api/liquidity?organization_id=${organization.id}`):null,
    selectedPlan?getBudgetPlan(selectedPlan.id).catch(()=>null):null,
    institutional&&organization?listAssets().catch(()=>null):null,
  ]);
  const activeAssets=assetRows?.filter((a:any)=>a.ownership_scope==='ORGANIZATION'&&a.organization_id===organization?.id&&a.status==='ACTIVE'&&a.lifecycle_status==='ACTIVE');
  const organizationAssets=activeAssets?{count:activeAssets.length,value:activeAssets.reduce((sum:Decimal,a:any)=>sum.add(a.current_market_value??0),new Decimal(0)).toFixed(2),goldWeightKg:activeAssets.filter((a:any)=>a.asset_type==='GOLD').reduce((sum:Decimal,a:any)=>sum.add(a.current_quantity??0),new Decimal(0)).div(1000).toFixed(3),silverWeightKg:activeAssets.filter((a:any)=>a.asset_type==='SILVER').reduce((sum:Decimal,a:any)=>sum.add(a.current_quantity??0),new Decimal(0)).div(1000).toFixed(3)}:null;
  return {organizations,organizationTree,organization,organizationAssets,plans:availablePlans.filter(p=>p.organization_name===organization?.name),selectedPlan,month,today,
    vat:vat?{totals:vat.periodTotals,period:vat.period,profileConfigured:!!vat.profile}:null,
    cash:cash?platformLiquiditySummary(cash,today):null,
    budget:plan?{metrics:buildBudgetMetrics(plan),plan}:null};
}
