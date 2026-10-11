import {describe,it,expect} from 'vitest';
import {dashboardBudgetOrganizations,dashboardBudgetSources,combineDashboardBudgets} from '../lib/platform-budget-summary';
import {buildBudgetMetrics,type BudgetPlan} from '../lib/budget-planning';
const plan=(id:string,organization_name:string,cost_center:string,revenue:number,opex:number):BudgetPlan=>({id,name:id,organization_name,cost_center,fiscal_year:2027,currency:'SAR',scenario:'BASE',status:'DRAFT',opening_cash:0,minimum_cash_target:0,assumptions:{},notes:'',lines:[{category:'REVENUE',name:'Revenue',line_type:'REVENUE',sort_order:0,monthly_budget:[revenue,...Array(11).fill(0)],monthly_actual:Array(12).fill(0)},{category:'OPEX',name:'Expense',line_type:'EXPENSE',sort_order:1,monthly_budget:[opex,...Array(11).fill(0)],monthly_actual:Array(12).fill(0)}]});
describe('dashboard saved budget totals',()=>{
 it('includes only the selected company and authorized descendants, never siblings or unrelated companies',()=>{
 const orgs=[{id:'p',name:'Parent'},{id:'c',name:'Child',parent_organization_id:'p'},{id:'g',name:'Grandchild',parent_organization_id:'c'},{id:'x',name:'Other'}];
 expect(dashboardBudgetOrganizations(orgs,'p',false).map(o=>o.name)).toEqual(['Parent']);
 expect(dashboardBudgetOrganizations(orgs,'p',true).map(o=>o.name)).toEqual(['Parent','Child','Grandchild']);
 expect(dashboardBudgetOrganizations(orgs,'c',true).map(o=>o.name)).toEqual(['Child','Grandchild']);
 });
 it('selects one latest plan per company and center for the same year and scenario, excluding saved totals and archives',()=>{
 const h={id:'latest',organization_name:'Parent',cost_center:'HQ',fiscal_year:2027,scenario:'BASE',currency:'SAR',status:'DRAFT'};
 const headers=[h,{...h,id:'old'},{...h,id:'ops',cost_center:'OPERATIONS'},{...h,id:'total',cost_center:'ALL'},{...h,id:'prior',fiscal_year:2026},{...h,id:'up',scenario:'UPSIDE'},{...h,id:'archive',cost_center:'CAPEX',status:'ARCHIVED'},{...h,id:'child',organization_name:'Child'},{...h,id:'other',organization_name:'Other'}];
 expect(dashboardBudgetSources(headers,['Parent'],2027,'BASE').map(p=>p.id)).toEqual(['latest','ops']);
 expect(dashboardBudgetSources(headers,['Parent','Child'],2027,'BASE').map(p=>p.id)).toEqual(['latest','ops','child']);
 });
 it('sums company centers then child company budgets without mutating saved inputs',()=>{
 const hq=plan('hq','Parent','HQ',60000,9600),ops=plan('ops','Parent','OPS',18000,1428),child=plan('child','Child','HQ',10000,2000);
 const before=JSON.stringify([hq,ops,child]);
 expect(buildBudgetMetrics(combineDashboardBudgets([hq,ops],'Parent','SAR')!)).toMatchObject({revenue:78000,ebitda:66972});
 expect(buildBudgetMetrics(combineDashboardBudgets([hq,ops,child],'Parent','SAR')!)).toMatchObject({revenue:88000,ebitda:74972});
 expect(JSON.stringify([hq,ops,child])).toBe(before);
 });
 it('does not invent empty budgets or silently sum different currencies, years or scenarios',()=>{
 const a=plan('a','Parent','HQ',100,10),b=plan('b','Child','HQ',200,20);
 expect(combineDashboardBudgets([],'Parent','SAR')).toBeNull();
 for(const change of [{currency:'USD'},{fiscal_year:2028},{scenario:'UPSIDE' as const}])expect(()=>combineDashboardBudgets([a,{...b,...change}],'Parent','SAR')).toThrow('MISMATCH');
 });
});
