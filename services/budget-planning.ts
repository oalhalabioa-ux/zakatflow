import {requireUser} from './auth';
import {budgetPlanSchema} from '@/lib/validation/schemas';
import type {BudgetLine,BudgetPlan} from '@/lib/budget-planning';

const PLAN_FIELDS='id,name,fiscal_year,currency,scenario,status,organization_name,cost_center,opening_cash,minimum_cash_target,assumptions,notes,created_at,updated_at';

export async function listBudgetPlans(filters?:{fiscal_year?:string|null;organization_name?:string|null;scenario?:string|null;cost_center?:string|null}){
 const {supabase,user}=await requireUser();
 let query=supabase.from('budget_plans').select(PLAN_FIELDS).eq('user_id',user.id);
 if(filters?.fiscal_year)query=query.eq('fiscal_year',Number(filters.fiscal_year));
 if(filters?.organization_name)query=query.eq('organization_name',filters.organization_name);
 if(filters?.scenario)query=query.eq('scenario',filters.scenario);
 if(filters?.cost_center&&filters.cost_center!=='ALL')query=query.eq('cost_center',filters.cost_center);
 else if(filters?.cost_center==='ALL')query=query.in('cost_center',['HQ','OPERATIONS']);
 const {data,error}=await query.order('updated_at',{ascending:false}).order('fiscal_year',{ascending:false});
 if(error)throw error; return data;
}

export async function getBudgetPlan(id:string):Promise<BudgetPlan>{
 const {supabase,user}=await requireUser();
 const {data:plan,error}=await supabase.from('budget_plans').select(`${PLAN_FIELDS},budget_lines(*)`).eq('id',id).eq('user_id',user.id).single();
 if(error)throw error;
 const raw=plan as any;
 return {...raw,lines:(raw.budget_lines??[]).sort((a:BudgetLine,b:BudgetLine)=>a.sort_order-b.sort_order)};
}

export async function createBudgetPlan(input:unknown){
 const parsed=budgetPlanSchema.parse(input),{lines,...planInput}=parsed;
 const {supabase,user}=await requireUser();
 const {data:plan,error}=await supabase.from('budget_plans').insert({...planInput,user_id:user.id,created_by:user.id}).select(PLAN_FIELDS).single();
 if(error)throw error;
 const {error:lineError}=await supabase.from('budget_lines').insert(lines.map(line=>({...line,plan_id:plan.id,user_id:user.id})));
 if(lineError){await supabase.from('budget_plans').delete().eq('id',plan.id).eq('user_id',user.id);throw lineError;}
 return getBudgetPlan(plan.id);
}

export async function updateBudgetPlan(id:string,input:unknown){
 const parsed=budgetPlanSchema.parse(input),{lines,...planInput}=parsed;
 const {supabase,user}=await requireUser();
 const {data:existing,error:existingError}=await supabase.from('budget_plans').select(PLAN_FIELDS).eq('id',id).eq('user_id',user.id).single();
 if(existingError)throw existingError;
 const {data:oldLines,error:oldLinesError}=await supabase.from('budget_lines').select('*').eq('plan_id',id).eq('user_id',user.id);
 if(oldLinesError)throw oldLinesError;
 const {error}=await supabase.from('budget_plans').update({...planInput,updated_at:new Date().toISOString()}).eq('id',id).eq('user_id',user.id);
 if(error)throw error;
 const {error:deleteError}=await supabase.from('budget_lines').delete().eq('plan_id',id).eq('user_id',user.id);
 if(deleteError){await supabase.from('budget_plans').update(existing).eq('id',id).eq('user_id',user.id);throw deleteError;}
 const {error:lineError}=await supabase.from('budget_lines').insert(lines.map(line=>({...line,id:undefined,plan_id:id,user_id:user.id})));
 if(lineError){await supabase.from('budget_lines').delete().eq('plan_id',id).eq('user_id',user.id);if(oldLines?.length)await supabase.from('budget_lines').insert(oldLines.map(({id:_,created_at:__,updated_at:___,...line}:any)=>line));await supabase.from('budget_plans').update(existing).eq('id',id).eq('user_id',user.id);throw lineError;}
 return getBudgetPlan(id);
}

export async function submitBudgetPlan(id:string,status:'IN_REVIEW'|'APPROVED'){
 const {supabase,user}=await requireUser();
 const {data:current,error:currentError}=await supabase.from('budget_plans').select('status').eq('id',id).eq('user_id',user.id).single();
 if(currentError)throw currentError;
 if(status==='IN_REVIEW'&&current.status!=='DRAFT')throw new Error('INVALID_STATUS_TRANSITION');
 if(status==='APPROVED'&&current.status!=='IN_REVIEW')throw new Error('INVALID_STATUS_TRANSITION');
 const {data,error}=await supabase.from('budget_plans').update({status,updated_at:new Date().toISOString()}).eq('id',id).eq('user_id',user.id).select(PLAN_FIELDS).single();
 if(error)throw error;
 const {error:eventError}=await supabase.from('budget_approval_events').insert({plan_id:id,user_id:user.id,action:status,actor_id:user.id});
 if(eventError)throw eventError;
 return data;
}
