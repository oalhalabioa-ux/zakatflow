import type {BudgetPlan} from './budget-planning';
export type DashboardBudgetScope='PLAN'|'COMPANY'|'GROUP';
type Org={id:string;name:string;parent_organization_id?:string|null};
type Header={id:string;organization_name:string;organization_id?:string|null;resolved_organization_id?:string;cost_center:string;fiscal_year:number;scenario:string;currency:string;status:string};
export function budgetPlanOrganizationId(plan:{organization_id?:string|null;resolved_organization_id?:string}){return plan.organization_id??plan.resolved_organization_id??null;}
export function dashboardBudgetOrganizations<T extends Org>(organizations:T[],id:string,group:boolean){
 const ids=new Set([id]);
 if(group){let changed=true;while(changed){changed=false;for(const o of organizations)if(o.parent_organization_id&&ids.has(o.parent_organization_id)&&!ids.has(o.id)){ids.add(o.id);changed=true;}}}
 return organizations.filter(o=>ids.has(o.id));
}
// Inputs are already membership/user filtered and ordered newest first.
export function dashboardBudgetSources<T extends Header>(plans:T[],scopes:string[],year:number,scenario:string){
 const seen=new Set<string>();
 return plans.filter(p=>{const owner=budgetPlanOrganizationId(p)??p.organization_name,key=`${owner}\u0000${p.cost_center}`;if(!scopes.includes(owner)||p.fiscal_year!==year||p.scenario!==scenario||p.status==='ARCHIVED'||!p.cost_center||p.cost_center==='ALL'||seen.has(key))return false;seen.add(key);return true;});
}
export function combineDashboardBudgets(plans:BudgetPlan[],organizationName:string,currency:string):BudgetPlan|null{
 if(!plans.length)return null;
 const first=plans[0];
 if(plans.some(p=>p.currency!==currency||p.fiscal_year!==first.fiscal_year||p.scenario!==first.scenario))throw new Error('BUDGET_SCOPE_CURRENCY_OR_PERIOD_MISMATCH');
 const byCompany=new Map<string,number>();for(const p of plans){const owner=budgetPlanOrganizationId(p)??p.organization_name;byCompany.set(owner,Math.max(byCompany.get(owner)??0,p.minimum_cash_target||0));}
 return {...first,id:undefined,organization_id:undefined,resolved_organization_id:undefined,name:'TOTAL',organization_name:organizationName,cost_center:'ALL',status:plans.every(p=>p.status==='APPROVED')?'APPROVED':'DRAFT',opening_cash:plans.reduce((s,p)=>s+Number(p.opening_cash||0),0),minimum_cash_target:[...byCompany.values()].reduce((s,v)=>s+v,0),assumptions:{...first.assumptions,actual_through_month:Math.min(...plans.map(p=>Number(p.assumptions.actual_through_month??0)))},lines:plans.flatMap(p=>p.lines.filter(l=>l.active!==false).map(l=>({...l,id:undefined,name:`${l.name} · ${p.organization_name} · ${p.cost_center}`,monthly_budget:[...l.monthly_budget],monthly_actual:[...l.monthly_actual],monthly_forecast:[...(l.monthly_forecast??l.monthly_budget)]})))};
}
