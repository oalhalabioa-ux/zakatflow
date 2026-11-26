import {beforeEach,expect,it,vi} from 'vitest';
const auth=vi.hoisted(()=>vi.fn());
vi.mock('./auth',()=>({requireUser:auth}));
import {createBudgetPlan,getBudgetPlan,listBudgetPlans,submitBudgetPlan,updateBudgetPlan} from './budget-planning';

const user='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const otherUser='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const orgA='11111111-1111-4111-8111-111111111111';
const orgB='22222222-2222-4222-8222-222222222222';
const planA='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const planB='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const monthly=(value:number)=>Array(12).fill(value);
const line=(plan:string,value:number)=>({id:plan+'-line',plan_id:plan,user_id:user,active:true,category:'OPEX',name:'Rent',line_type:'EXPENSE',sort_order:1,monthly_budget:monthly(value),monthly_actual:monthly(0),monthly_forecast:monthly(value)});
const plan=(id:string,org:string|null,name:string)=>({id,user_id:user,created_by:user,name:'Budget',fiscal_year:2027,currency:'SAR',scenario:'BASE',status:'DRAFT',organization_id:org,organization_name:name,cost_center:'OPS',opening_cash:0,minimum_cash_target:0,assumptions:{},notes:''});
let tables:Record<string,any[]>;
let writes:Array<{table:string;action:string;payload:any}>;

function from(table:string){
 let filters:Array<(row:any)=>boolean>=[],action='read',payload:any,single=false,nested=false,cached:Promise<any>|undefined;
 const q:any={
  select:(fields:string)=>{nested=fields.includes('budget_lines(');return q;},
  eq:(key:string,value:any)=>{filters.push(row=>row[key]===value);return q;},
  neq:(key:string,value:any)=>{filters.push(row=>row[key]!==value);return q;},
  in:(key:string,values:any[])=>{filters.push(row=>values.includes(row[key]));return q;},
  order:()=>q,
  single:()=>{single=true;return q;},
  maybeSingle:()=>{single=true;return q;},
  insert:(value:any)=>{action='insert';payload=value;return q;},
  update:(value:any)=>{action='update';payload=value;return q;},
  delete:()=>{action='delete';return q;},
  then:(resolve:any,reject:any)=>{
   cached??=Promise.resolve().then(()=>{
    const data=tables[table]??(tables[table]=[]);
    let rows=data.filter(row=>filters.every(filter=>filter(row)));
    if(table==='financial_budget_plan_ownership')rows=rows.filter(row=>tables.organization_members.some(member=>member.user_id===user&&member.organization_id===row.organization_id&&member.status==='ACTIVE'));
    if(action!=='read')writes.push({table,action,payload:structuredClone(payload)});
    if(action==='insert'){
     rows=(Array.isArray(payload)?payload:[payload]).map(value=>({...value,id:value.id??'cccccccc-cccc-4ccc-8ccc-ccccccccccc1'}));
     data.push(...rows);
    }
    if(action==='update')for(const row of rows)for(const [key,value] of Object.entries(payload))if(value!==undefined)row[key]=structuredClone(value);
    if(action==='delete')tables[table]=data.filter(row=>!rows.includes(row));
    rows=rows.map(row=>({...structuredClone(row),...(nested?{budget_lines:structuredClone(tables.budget_lines.filter(line=>line.plan_id===row.id))}:{})}));
    return {data:single?rows[0]??null:rows,error:null};
   });
   return cached.then(resolve,reject);
  },
 };
 return q;
}
function input(organization=orgA){return {...plan(planA,organization,organization===orgA?'Alpha':'Beta'),lines:[{category:'OPEX',name:'Rent',line_type:'EXPENSE',sort_order:1,monthly_budget:monthly(20),monthly_actual:monthly(0)}]};}

beforeEach(()=>{
 writes=[];
 tables={
  organizations:[{id:orgA,name:'Alpha',parent_organization_id:null},{id:orgB,name:'Beta',parent_organization_id:null}],
  organization_members:[{organization_id:orgA,user_id:user,status:'ACTIVE',role:'OWNER'},{organization_id:orgB,user_id:user,status:'ACTIVE',role:'OWNER'}],
  budget_plans:[plan(planA,orgA,'Alpha'),plan(planB,orgB,'Beta')],
  budget_lines:[line(planA,10),line(planB,90)],
  financial_budget_plan_ownership:[],budget_approval_events:[],
 };
 auth.mockResolvedValue({user:{id:user},supabase:{from}});
});

it('lists only the selected company when both companies use the same cost center and period',async()=>{
 for(const [organization,id] of [[orgA,planA],[orgB,planB]]){
  const rows=await listBudgetPlans({organization_id:organization,fiscal_year:'2027',scenario:'BASE',cost_center:'OPS',organization_name:'ignored label'});
  expect(rows.map(row=>row.id)).toEqual([id]);
  expect(rows[0].resolved_organization_id).toBe(organization);
 }
 expect(writes).toEqual([]);
});

it('groups authorized descendants by durable company identity only when explicitly requested',async()=>{
 tables.organizations[1].parent_organization_id=orgA;
 expect((await listBudgetPlans({organization_id:orgA})).map(row=>row.id)).toEqual([planA]);
 expect((await listBudgetPlans({organization_id:orgA,group:true})).map(row=>row.id)).toEqual([planA,planB]);
});

it('rejects a stale detail, update or status target from a different company before any write',async()=>{
 const before=structuredClone(tables);
 await expect(getBudgetPlan(planB,orgA)).rejects.toThrow('BUDGET_ORGANIZATION_SCOPE_MISMATCH');
 await expect(updateBudgetPlan(planB,input(orgA))).rejects.toThrow('BUDGET_ORGANIZATION_SCOPE_MISMATCH');
 await expect(submitBudgetPlan(planB,'IN_REVIEW',orgA)).rejects.toThrow('BUDGET_ORGANIZATION_SCOPE_MISMATCH');
 expect(writes).toEqual([]);expect(tables).toEqual(before);
});

it('requires active selected-company membership even for an owner-authored budget',async()=>{
 tables.organization_members[0].status='REMOVED';
 for(const read of [()=>listBudgetPlans({organization_id:orgA}),()=>getBudgetPlan(planA,orgA),()=>createBudgetPlan(input()),()=>submitBudgetPlan(planA,'IN_REVIEW',orgA)])
  await expect(read()).rejects.toThrow('ORGANIZATION_ACCESS_REQUIRED');
 expect(writes).toEqual([]);
});

it('preserves the existing owner-only boundary instead of granting access to another member\'s plan',async()=>{
 tables.budget_plans[0].user_id=otherUser;
 expect(await listBudgetPlans({organization_id:orgA})).toEqual([]);
 await expect(getBudgetPlan(planA,orgA)).rejects.toThrow('BUDGET_PLAN_NOT_FOUND');
 expect(writes).toEqual([]);
});

it('reads an authoritatively adopted owner legacy plan without binding or renaming persisted history',async()=>{
 tables.budget_plans[0].organization_id=null;
 tables.financial_budget_plan_ownership.push({plan_id:planA,organization_id:orgA});
 const before=structuredClone(tables);
 const rows=await listBudgetPlans({organization_id:orgA});
 expect(rows).toMatchObject([{id:planA,organization_id:null,resolved_organization_id:orgA}]);
 expect((await getBudgetPlan(planA,orgA)).lines[0].monthly_budget).toEqual(monthly(10));
 expect(writes).toEqual([]);expect(tables).toEqual(before);
});

it('does not infer a hidden revoked adoption from a colliding currently authorized company name',async()=>{
 tables.budget_plans[0].organization_id=null;
 tables.financial_budget_plan_ownership.push({plan_id:planA,organization_id:orgA});
 tables.organization_members[0].status='REMOVED';
 tables.organizations[1].name='Alpha';
 const before=structuredClone(tables);
 for(const operation of [()=>listBudgetPlans({organization_id:orgB}),()=>getBudgetPlan(planA,orgB),()=>updateBudgetPlan(planA,input(orgB)),()=>createBudgetPlan(input(orgB))])
  await expect(operation()).rejects.toThrow('BUDGET_LEGACY_SCOPE_UNRESOLVED');
 expect(writes).toEqual([]);expect(tables).toEqual(before);
});

it('excludes unrelated unbound history without blocking another company list or assigning it by name',async()=>{
 tables.budget_plans[0].organization_id=null;
 expect((await listBudgetPlans({organization_id:orgB})).map(row=>row.id)).toEqual([planB]);
 await expect(listBudgetPlans({organization_id:orgA})).rejects.toThrow('BUDGET_LEGACY_SCOPE_UNRESOLVED');
 await expect(getBudgetPlan(planA,orgA)).rejects.toThrow('BUDGET_LEGACY_SCOPE_UNRESOLVED');
 expect(writes).toEqual([]);
});

it('fails closed for a legacy name shared by two authorized companies',async()=>{
 tables.organizations[1].name='Alpha';tables.budget_plans[0].organization_id=null;
 await expect(listBudgetPlans({organization_id:orgA})).rejects.toThrow('BUDGET_ORGANIZATION_AMBIGUOUS');
 await expect(getBudgetPlan(planA,orgA)).rejects.toThrow('BUDGET_ORGANIZATION_AMBIGUOUS');
 await expect(updateBudgetPlan(planA,input())).rejects.toThrow('BUDGET_ORGANIZATION_AMBIGUOUS');
 expect(writes).toEqual([]);
});

it('honors existing Financial Core adoption instead of adopting the display name into a different company',async()=>{
 tables.budget_plans[0].organization_id=null;
 tables.financial_budget_plan_ownership.push({plan_id:planA,organization_id:orgB});
 expect(await listBudgetPlans({organization_id:orgA})).toEqual([]);
 await expect(getBudgetPlan(planA,orgA)).rejects.toThrow('BUDGET_ORGANIZATION_SCOPE_MISMATCH');
 expect((await getBudgetPlan(planA,orgB)).resolved_organization_id).toBe(orgB);
 expect(writes).toEqual([]);
});

it('reuses only the selected company plan and preserves unrelated plan history and lines',async()=>{
 const otherPlan=structuredClone(tables.budget_plans[1]),otherLine=structuredClone(tables.budget_lines[1]);
 const updated=await createBudgetPlan({...input(),organization_name:'Beta'});
 expect(updated.id).toBe(planA);expect(updated.organization_id).toBe(orgA);expect(updated.organization_name).toBe('Alpha');
 expect(updated.lines[0].monthly_budget).toEqual(monthly(20));
 expect(tables.budget_plans[1]).toEqual(otherPlan);expect(tables.budget_lines[1]).toEqual(otherLine);
 expect(tables.budget_lines).toHaveLength(2);
});

it('does not redirect a same-name uniqueness collision into another company\'s plan',async()=>{
 tables.organizations[1].name='Alpha';tables.budget_plans=tables.budget_plans.slice(0,1);
 await expect(createBudgetPlan(input(orgB))).rejects.toThrow('BUDGET_ORGANIZATION_NAME_COLLISION');
 expect(writes).toEqual([]);
});

it('requires an explicit company for reads, updates and approval transitions',async()=>{
 const {organization_id,...unscoped}=input();
 for(const operation of [()=>listBudgetPlans(),()=>getBudgetPlan(planA),()=>createBudgetPlan(unscoped),()=>updateBudgetPlan(planA,unscoped),()=>submitBudgetPlan(planA,'IN_REVIEW')])
  await expect(operation()).rejects.toThrow('ORGANIZATION_ID_REQUIRED');
 expect(writes).toEqual([]);
});

it('records an approval event only for the selected owner plan and keeps the existing transition rules',async()=>{
 await submitBudgetPlan(planA,'IN_REVIEW',orgA);
 expect(tables.budget_plans[0].status).toBe('IN_REVIEW');expect(tables.budget_plans[1].status).toBe('DRAFT');
 expect(tables.budget_approval_events).toMatchObject([{plan_id:planA,user_id:user,actor_id:user,action:'IN_REVIEW'}]);
 await expect(submitBudgetPlan(planA,'IN_REVIEW',orgA)).rejects.toThrow('INVALID_STATUS_TRANSITION');
});

it('preserves historical personal-Zakat budget data but blocks review and approval until its source is reviewed',async()=>{
 tables.budget_plans[0].assumptions={zakat_source:'ZAKATFLOW_READ_ONLY_BASELINE',zakat_baseline_due:32000};
 expect((await getBudgetPlan(planA,orgA)).assumptions.zakat_baseline_due).toBe(32000);
 await expect(submitBudgetPlan(planA,'IN_REVIEW',orgA)).rejects.toThrow('BUDGET_ZAKAT_SOURCE_REVIEW_REQUIRED');
 await expect(updateBudgetPlan(planA,{...input(),status:'APPROVED',assumptions:tables.budget_plans[0].assumptions})).rejects.toThrow('BUDGET_ZAKAT_SOURCE_REVIEW_REQUIRED');
 expect(writes).toEqual([]);
 const saved=await updateBudgetPlan(planA,{...input(),status:'DRAFT',assumptions:tables.budget_plans[0].assumptions});
 expect(saved.assumptions.zakat_baseline_due).toBe(32000);expect(saved.status).toBe('DRAFT');
});
