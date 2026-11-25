import {preferredOrganization} from '../lib/workspace-organization';
import {yaqeenRecentAccountingDocuments} from '../lib/yaqeen-recent-documents';
import {platformAssetSummary} from '@/lib/platform-asset-summary';
import {listAssets} from './assets';
import {platformOrganizationTree} from '@/lib/platform-organization-tree';
import {getPlatformOverview} from './platform-overview';
import {requireUser} from './auth';
import {listBudgetPlans,getBudgetPlan} from './budget-planning';
import {budgetPlanOrganizationId,dashboardBudgetOrganizations,dashboardBudgetSources,combineDashboardBudgets,type DashboardBudgetScope} from '@/lib/platform-budget-summary';
import {buildBudgetMetrics} from '@/lib/budget-planning';
import {platformGroupVat,platformGroupCash,platformGroupCurrencyKnown} from '@/lib/platform-group-summary';
import {platformLiquiditySummary} from '@/lib/platform-liquidity-summary';
import {GET as readVat} from '@/app/api/vat/route';
import {GET as readLiquidity} from '@/app/api/liquidity/route';

// Reuse the authenticated module read handlers in-process. No HTTP loop, writes,
// service-role access, new financial recognition rules. Budget groups are read-only saved-plan totals.
export async function getPlatformFinancialOverview(q:{organization?:string;plan?:string;month?:string;scope?:string;budget_scope?:string;year?:string;scenario?:string;level?:string;asset_basis?:string}) {
  const {supabase,user}=await requireUser();
  const institutional=q.scope==='ORGANIZATION';
  const members=await supabase.from('organization_members').select('organization_id').eq('user_id',user.id).eq('status','ACTIVE');
  if(members.error)throw members.error;
  const ids=(members.data??[]).map(m=>m.organization_id);
  const orgs=ids.length?await supabase.from('organizations').select('id,name,base_currency,organization_kind,parent_organization_id,sort_order').in('id',ids).order('name'):{data:[],error:null};
  if(orgs.error)throw orgs.error;
  const organizationTree=platformOrganizationTree(orgs.data??[]);
  const organizations=organizationTree.map(x=>x.organization);
  if(q.organization!==undefined&&!organizations.some(o=>o.id===q.organization))throw new Error('ORGANIZATION_ACCESS_REQUIRED');
  const organization=preferredOrganization(organizations,q.organization)??null;
  const group=q.level==='GROUP';
  let budgetReadFailed=false;
  let plans:Awaited<ReturnType<typeof listBudgetPlans>>=[];
  if(institutional&&organization){
    try{plans=await listBudgetPlans({organization_id:organization.id,group});}
    catch{budgetReadFailed=true;}
  }
  const availablePlans=(plans??[]).filter(p=>p.status!=='ARCHIVED');
  if(institutional&&!budgetReadFailed&&q.plan&&!availablePlans.some(p=>p.id===q.plan))throw new Error('BUDGET_PLAN_ACCESS_REQUIRED');
  const reportOrganizations=organization?dashboardBudgetOrganizations(organizations,organization.id,group):[];
  const reportIds=reportOrganizations.map(o=>o.id);
  const currencyKnown=platformGroupCurrencyKnown(reportOrganizations,organization?.base_currency??'SAR');
  const budgetScope:DashboardBudgetScope=group?'GROUP':q.budget_scope==='PLAN'?'PLAN':'COMPANY';
  const budgetOrganizations=reportOrganizations;
  const scopedHeaders=availablePlans.filter(p=>reportIds.includes(budgetPlanOrganizationId(p)??'')&&p.cost_center!=='ALL');
  const referencePlan=availablePlans.find(p=>p.id===q.plan&&budgetPlanOrganizationId(p)===organization?.id&&p.cost_center!=='ALL')??scopedHeaders[0]??null;
  const year=/^20\d{2}$/.test(q.year??'')?Number(q.year):referencePlan?.fiscal_year??new Date().getFullYear();
  const scenario=['BASE','DOWNSIDE','UPSIDE'].includes(q.scenario??'')?q.scenario!:referencePlan?.scenario??'BASE';
  const matching=dashboardBudgetSources(availablePlans,reportIds,year,scenario);
  const selectedPlan=matching.find(p=>p.id===q.plan)??matching.find(p=>budgetPlanOrganizationId(p)===organization?.id)??matching[0]??null;
  const sources=budgetScope==='PLAN'?matching.filter(p=>p.id===selectedPlan?.id):matching;
  const years=[...new Set([year,...scopedHeaders.map(p=>p.fiscal_year)])].sort((a,b)=>b-a);
  const missingBudgetCompanies=budgetOrganizations.filter(o=>!sources.some(p=>budgetPlanOrganizationId(p)===o.id)).map(o=>o.name);
  async function readBudget(){if(budgetReadFailed)return null;try{const details=await Promise.all(sources.map(p=>getBudgetPlan(p.id,budgetPlanOrganizationId(p))));const combined=budgetScope==='PLAN'?details[0]??null:combineDashboardBudgets(details,organization?.name??'',organization?.base_currency??'SAR');return combined?{metrics:buildBudgetMetrics(combined),plan:combined}:null;}catch{budgetReadFailed=true;return null;}}
  const today=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Riyadh'});
  const month=/^\d{4}-(0[1-9]|1[0-2])$/.test(q.month??'')?q.month!:today.slice(0,7);
  async function read(handler:(req:Request)=>Promise<Response>,path:string) {
    try {const response=await handler(new Request(`https://zakatflow.local${path}`));return response.ok?await response.json():null;}catch{return null;}
  }
  const [vatReads,cashReads,budget,assetRows,modules]=await Promise.all([
    institutional&&currencyKnown?Promise.all(reportOrganizations.map(o=>read(readVat,`/api/vat?organization_id=${o.id}&period_month=${month}`))):Promise.resolve([]),
    institutional&&currencyKnown?Promise.all(reportOrganizations.map(o=>read(readLiquidity,`/api/liquidity?organization_id=${o.id}`))):Promise.resolve([]),
    institutional?readBudget():null,
    institutional&&organization?listAssets().catch(()=>null):null,
    institutional&&organization?getPlatformOverview(organization.id,organization.name,reportIds).catch(()=>null):null,
  ]);
  const activeAssets=assetRows?.filter((a:any)=>a.ownership_scope==='ORGANIZATION'&&reportIds.includes(a.organization_id)&&a.status==='ACTIVE'&&a.lifecycle_status==='ACTIVE');
  const vat=platformGroupVat(vatReads);
  const cash=platformGroupCash(cashReads);
  const assetBasis=q.asset_basis==='MARKET'?'MARKET':'BOOK';
  const organizationAssets=currencyKnown?platformAssetSummary(activeAssets??null,cash,assetBasis):null;
  return {modules,assetBasis,organizations,organizationTree,organization,organizationAssets,group,reportOrganizations,reportIds,currencyKnown,vatPeriodMismatch:vatReads.length>0&&vatReads.every(Boolean)&&!vat,plans:availablePlans.filter(p=>budgetPlanOrganizationId(p)===organization?.id&&p.cost_center!=='ALL'),selectedPlan,month,today,budgetScope,year,years,scenario,budgetReadFailed,budgetSourceCount:sources.length,budgetApprovedSourceCount:sources.filter(p=>p.status==='APPROVED').length,missingBudgetCompanies,
    // Presentation only: reuse the VAT documents already read under each organization permission.
    recentDocuments:yaqeenRecentAccountingDocuments(vatReads),
    vat,
    cash:cash?platformLiquiditySummary(cash,today):null,
    budget};
}
