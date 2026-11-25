import {requireUser} from './auth';
import {requireOrganizationMember} from './organization-access';
import {z} from 'zod';
import {budgetPlanSchema} from '../lib/validation/schemas';
import {normalizeCostCenterBudgetPlan,selectPersistedBudgetLine} from '../lib/budget-planning';
import type {BudgetLine,BudgetPlan} from '../lib/budget-planning';
import {organizationScopeIds} from '../lib/workspace-organization';

const PLAN_FIELDS='id,name,fiscal_year,currency,scenario,status,organization_id,organization_name,cost_center,opening_cash,minimum_cash_target,assumptions,notes,created_at,updated_at';
type BudgetFilters={organization_id?:string|null;group?:boolean;fiscal_year?:string|null;organization_name?:string|null;scenario?:string|null;cost_center?:string|null};
type BudgetOrganization={id:string;name:string;parent_organization_id?:string|null;organization_kind?:string};
function assertReviewedZakatSource(plan:{status?:string;assumptions?:Record<string,unknown>},status=plan.status){
 if(['IN_REVIEW','APPROVED'].includes(status??'')&&plan.assumptions?.zakat_source==='ZAKATFLOW_READ_ONLY_BASELINE')throw Error('BUDGET_ZAKAT_SOURCE_REVIEW_REQUIRED');
}

async function budgetContext(organizationId?:string|null,group=false){
 if(!organizationId)throw Error('ORGANIZATION_ID_REQUIRED');
 z.string().uuid().parse(organizationId);
 const {supabase,user}=await requireUser();
 await requireOrganizationMember(supabase,user.id,organizationId);
 const members=await supabase.from('organization_members').select('organization_id').eq('user_id',user.id).eq('status','ACTIVE');
 if(members.error)throw members.error;
 const memberIds=(members.data??[]).map(m=>m.organization_id);
 const organizations=await supabase.from('organizations').select('id,name,parent_organization_id,organization_kind').in('id',memberIds);
 if(organizations.error)throw organizations.error;
 const rows=(organizations.data??[]) as BudgetOrganization[],organization=rows.find(o=>o.id===organizationId);
 if(!organization)throw Error('ORGANIZATION_ACCESS_REQUIRED');
 const organizationIds=organizationScopeIds(rows,organizationId,group);
 for(const id of organizationIds)if(id!==organizationId)await requireOrganizationMember(supabase,user.id,id);
 return {supabase,user,organizations:rows,organization,organizationIds};
}
type BudgetContext=Awaited<ReturnType<typeof budgetContext>>;

async function adoptedOwners(context:BudgetContext,plans:Array<{id:string;organization_id?:string|null}>){
 const ids=plans.filter(p=>!p.organization_id).map(p=>p.id);
 if(!ids.length)return new Map<string,string>();
 const {data,error}=await context.supabase.from('financial_budget_plan_ownership').select('plan_id,organization_id').in('plan_id',ids);
 if(error)throw error;
 return new Map<string,string>((data??[]).map(row=>[row.plan_id,row.organization_id]));
}

/** A name can identify a reconciliation warning, never establish company ownership. */
function resolvedOwner(plan:{id:string;organization_id?:string|null;organization_name:string},context:BudgetContext,adopted:Map<string,string>,required=false){
 const bound=plan.organization_id??adopted.get(plan.id);
 if(bound)return bound;
 const matches=context.organizations.filter(o=>o.name===plan.organization_name);
 const relevant=required||context.organizations.some(o=>context.organizationIds.has(o.id)&&o.name===plan.organization_name);
 // A missing adoption row may be hidden by RLS after membership revocation.
 // Even a unique currently authorized name cannot prove that no other owner exists.
 if(relevant)throw Error(matches.length>1?'BUDGET_ORGANIZATION_AMBIGUOUS':'BUDGET_LEGACY_SCOPE_UNRESOLVED');
 return null;
}

async function readOwnedPlan(context:BudgetContext,id:string){
 z.string().uuid().parse(id);
 const {data,error}=await context.supabase.from('budget_plans').select(`${PLAN_FIELDS},budget_lines(*)`).eq('id',id).eq('user_id',context.user.id).single();
 if(error)throw error;
 if(!data)throw Error('BUDGET_PLAN_NOT_FOUND');
 const raw=data as any,adopted=await adoptedOwners(context,[raw]),owner=resolvedOwner(raw,context,adopted,true);
 if(owner!==context.organization.id)throw Error('BUDGET_ORGANIZATION_SCOPE_MISMATCH');
 return {...raw,resolved_organization_id:owner};
}

function parsePersistedPlan(input:unknown){
 if(!input||typeof input!=='object'||!('organization_id' in input)||!input.organization_id)throw Error('ORGANIZATION_ID_REQUIRED');
 const parsed=budgetPlanSchema.extend({organization_id:z.string().uuid()}).parse(input);
 assertReviewedZakatSource(parsed);
 if(!parsed.cost_center||parsed.cost_center==='ALL')throw new Error('SPECIFIC_COST_CENTER_REQUIRED');
 const normalized=parsed.cost_center==='HQ'||parsed.cost_center==='OPERATIONS'
  ? normalizeCostCenterBudgetPlan(parsed as BudgetPlan,parsed.cost_center)
  : parsed as BudgetPlan;
 const {lines,...planInput}=normalized;
 return {lines,planInput};
}

export async function listBudgetPlans(filters?:BudgetFilters){
 const context=await budgetContext(filters?.organization_id,filters?.group),{supabase,user}=context;
 let query=supabase.from('budget_plans').select(PLAN_FIELDS).eq('user_id',user.id);
 if(filters?.fiscal_year)query=query.eq('fiscal_year',Number(filters.fiscal_year));
 if(filters?.scenario)query=query.eq('scenario',filters.scenario);
 if(filters?.cost_center&&filters.cost_center!=='ALL')query=query.eq('cost_center',filters.cost_center);
 else if(filters?.cost_center==='ALL')query=query.neq('cost_center','ALL');
 const {data,error}=await query.order('updated_at',{ascending:false}).order('fiscal_year',{ascending:false});
 if(error)throw error;
 const rows=(data??[]) as any[],adopted=await adoptedOwners(context,rows);
 return rows.flatMap(plan=>{const owner=resolvedOwner(plan,context,adopted);return owner&&context.organizationIds.has(owner)?[{...plan,resolved_organization_id:owner}]:[];});
}

export async function getBudgetPlan(id:string,organizationId?:string|null):Promise<BudgetPlan>{
 const context=await budgetContext(organizationId),raw=await readOwnedPlan(context,id);
 const lines=(raw.budget_lines??[]).filter((line:BudgetLine)=>line.active!==false).sort((a:BudgetLine,b:BudgetLine)=>a.sort_order-b.sort_order);
 // Legacy plans may contain duplicated or cross-center rows. Normalize the
 // response for display and calculations without deleting anything persisted.
 return raw.cost_center==='HQ'||raw.cost_center==='OPERATIONS'
  ? normalizeCostCenterBudgetPlan({...raw,lines},raw.cost_center)
  : {...raw,lines};
}

export async function createBudgetPlan(input:unknown){
 const {lines,planInput}=parsePersistedPlan(input);
 const context=await budgetContext(planInput.organization_id),{supabase,user}=context;
 // Bind new records to the selected authorized institution; ignore an editable label.
 planInput.organization_name=context.organization.name;
 // The UI can legitimately lose the transient id while switching between
 // cost-center views. Reuse the existing scoped plan instead of attempting a
 // second insert that would hit the composite uniqueness constraint.
 const {data:candidates,error:lookupError}=await supabase.from('budget_plans').select(PLAN_FIELDS).eq('user_id',user.id)
  .eq('fiscal_year',planInput.fiscal_year).eq('scenario',planInput.scenario)
  .eq('cost_center',planInput.cost_center);
 if(lookupError)throw lookupError;
 const rows=(candidates??[]) as any[],adopted=await adoptedOwners(context,rows);
 const matching=rows.filter(row=>resolvedOwner(row,context,adopted)===context.organization.id);
 if(matching.length>1)throw Error('BUDGET_SCOPE_DUPLICATE');
 if(matching[0]?.id)return updateBudgetPlan(matching[0].id,input);
 // The historical database uniqueness key still contains the display name.
 // Never turn its collision into an update of another institution's record.
 if(rows.some(row=>row.organization_name===context.organization.name))throw Error('BUDGET_ORGANIZATION_NAME_COLLISION');
 const {data:plan,error}=await supabase.from('budget_plans').insert({...planInput,user_id:user.id,created_by:user.id}).select(PLAN_FIELDS).single();
 if(error)throw error;
 const {error:lineError}=await supabase.from('budget_lines').insert(lines.map(line=>({...line,active:true,plan_id:plan.id,user_id:user.id})));
 if(lineError){await supabase.from('budget_plans').delete().eq('id',plan.id).eq('user_id',user.id);throw lineError;}
 return getBudgetPlan(plan.id,context.organization.id);
}

export async function updateBudgetPlan(id:string,input:unknown){
 const {lines,planInput}=parsePersistedPlan(input);
 const context=await budgetContext(planInput.organization_id),{supabase,user}=context;
 const current=await readOwnedPlan(context,id);
 const {budget_lines:_nested,resolved_organization_id:_resolved,...existing}=current;
 // An explicit edit may bind a verified legacy row through the existing DB trigger;
 // it must never rename, transfer or overwrite another company's saved plan.
 planInput.organization_name=existing.organization_name;
 const {data:oldLines,error:oldLinesError}=await supabase.from('budget_lines').select('*').eq('plan_id',id).eq('user_id',user.id).eq('active',true);
 if(oldLinesError)throw oldLinesError;
 const {error}=await supabase.from('budget_plans').update({...planInput,updated_at:new Date().toISOString()}).eq('id',id).eq('user_id',user.id);
 if(error)throw error;
 // Normal saves must never clear the persisted budget rows. Update known rows and
 // append only genuinely new rows; destructive cleanup belongs to an explicit
 // budget-data clearing action, not to the regular save path.
 const changedExisting:any[]=[];
 const insertedIds:string[]=[];
 const usedLineIds=new Set<string>();
 try{
  for(const line of lines){
   const payload={...line,plan_id:id,user_id:user.id};
   const previous=selectPersistedBudgetLine(line,oldLines??[],usedLineIds);
   if(previous?.id){
    usedLineIds.add(previous.id);
    changedExisting.push(previous);
    const {error:lineError}=await supabase.from('budget_lines').update({...payload,id:undefined,updated_at:new Date().toISOString()}).eq('id',previous.id).eq('plan_id',id).eq('user_id',user.id);
    if(lineError)throw lineError;
   }else{
    const {data:created,error:lineError}=await supabase.from('budget_lines').insert({...payload,active:true,id:undefined}).select('id').single();
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
 return getBudgetPlan(id,context.organization.id);
}

export async function submitBudgetPlan(id:string,status:'IN_REVIEW'|'APPROVED',organizationId?:string|null){
 const context=await budgetContext(organizationId),{supabase,user}=context,current=await readOwnedPlan(context,id);
 assertReviewedZakatSource(current,status);
 if(status==='IN_REVIEW'&&current.status!=='DRAFT')throw new Error('INVALID_STATUS_TRANSITION');
 if(status==='APPROVED'&&current.status!=='IN_REVIEW')throw new Error('INVALID_STATUS_TRANSITION');
 const {data,error}=await supabase.from('budget_plans').update({status,updated_at:new Date().toISOString()}).eq('id',id).eq('user_id',user.id).select(PLAN_FIELDS).single();
 if(error)throw error;
 const {error:eventError}=await supabase.from('budget_approval_events').insert({plan_id:id,user_id:user.id,action:status,actor_id:user.id});
 if(eventError)throw eventError;
 return data;
}
