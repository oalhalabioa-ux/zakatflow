import {requireUser} from './auth';
import {budgetPlanSchema} from '@/lib/validation/schemas';
import {normalizeCostCenterBudgetPlan} from '@/lib/budget-planning';
import type {BudgetLine,BudgetPlan} from '@/lib/budget-planning';

const PLAN_FIELDS='id,name,fiscal_year,currency,scenario,status,organization_name,cost_center,opening_cash,minimum_cash_target,assumptions,notes,created_at,updated_at';

function parsePersistedPlan(input:unknown){
 const parsed=budgetPlanSchema.parse(input);
 if(parsed.cost_center!=='HQ'&&parsed.cost_center!=='OPERATIONS')throw new Error('SPECIFIC_COST_CENTER_REQUIRED');
 const normalized=normalizeCostCenterBudgetPlan(parsed as BudgetPlan,parsed.cost_center);
 const {lines,...planInput}=normalized;
 return {lines,planInput};
}

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
 const lines=(raw.budget_lines??[]).sort((a:BudgetLine,b:BudgetLine)=>a.sort_order-b.sort_order);
 // Legacy plans may contain duplicated or cross-center rows. Normalize the
 // response for display and calculations without deleting anything persisted.
 return raw.cost_center==='HQ'||raw.cost_center==='OPERATIONS'
  ? normalizeCostCenterBudgetPlan({...raw,lines},raw.cost_center)
  : {...raw,lines};
}

export async function createBudgetPlan(input:unknown){
 const {lines,planInput}=parsePersistedPlan(input);
 const {supabase,user}=await requireUser();
 const {data:plan,error}=await supabase.from('budget_plans').insert({...planInput,user_id:user.id,created_by:user.id}).select(PLAN_FIELDS).single();
 if(error)throw error;
 const {error:lineError}=await supabase.from('budget_lines').insert(lines.map(line=>({...line,plan_id:plan.id,user_id:user.id})));
 if(lineError){await supabase.from('budget_plans').delete().eq('id',plan.id).eq('user_id',user.id);throw lineError;}
 return getBudgetPlan(plan.id);
}

export async function updateBudgetPlan(id:string,input:unknown){
 const {lines,planInput}=parsePersistedPlan(input);
 const {supabase,user}=await requireUser();
 const {data:existing,error:existingError}=await supabase.from('budget_plans').select(PLAN_FIELDS).eq('id',id).eq('user_id',user.id).single();
 if(existingError)throw existingError;
 const {data:oldLines,error:oldLinesError}=await supabase.from('budget_lines').select('*').eq('plan_id',id).eq('user_id',user.id);
 if(oldLinesError)throw oldLinesError;
 const {error}=await supabase.from('budget_plans').update({...planInput,updated_at:new Date().toISOString()}).eq('id',id).eq('user_id',user.id);
 if(error)throw error;
 // Normal saves must never clear the persisted budget rows. Update known rows and
 // append only genuinely new rows; destructive cleanup belongs to an explicit
 // budget-data clearing action, not to the regular save path.
 const changedExisting:any[]=[];
 const insertedIds:string[]=[];
 try{
  for(const line of lines){
   const payload={...line,plan_id:id,user_id:user.id};
   if(line.id){
    const previous=oldLines?.find((old:any)=>old.id===line.id);
    if(!previous)continue;
    changedExisting.push(previous);
    const {error:lineError}=await supabase.from('budget_lines').update({...payload,id:undefined}).eq('id',line.id).eq('plan_id',id).eq('user_id',user.id);
    if(lineError)throw lineError;
   }else{
    const {data:created,error:lineError}=await supabase.from('budget_lines').insert({...payload,id:undefined}).select('id').single();
    if(lineError)throw lineError;
    if(created?.id)insertedIds.push(created.id);
   }
  }
 }catch(lineError){
  for(const previous of changedExisting){
   const {id:lineId,...restore}=previous;
   await supabase.from('budget_lines').update(restore).eq('id',lineId).eq('plan_id',id).eq('user_id',user.id);
  }
  if(insertedIds.length)await supabase.from('budget_lines').delete().in('id',insertedIds).eq('plan_id',id).eq('user_id',user.id);
  await supabase.from('budget_plans').update(existing).eq('id',id).eq('user_id',user.id);
  throw lineError;
 }
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
