import Decimal from 'decimal.js';
import {z} from 'zod';
import {requireUser} from './auth';
import {liveDimensionalStatements} from './financial-dimensional-statements';
import {statementQuery} from '../lib/financial-statement-source';
import {assertStableFinancialReplay} from '../lib/financial-source-replay';
import type {costCenterIncome} from '../lib/financial-cost-center-income';
const Money=Decimal.clone({precision:50});
/** Position/cash pickers must use the same verified dimension source as their report. */
export async function liveDimensionalCenterOptions(input:unknown,selection?:unknown):Promise<ReturnType<typeof costCenterIncome>&{branch:string}>{
 const query=statementQuery.parse(input);
 const branch=selection===undefined?'ALL':z.union([z.literal('HQ'),z.string().uuid()]).parse(selection);
 const source=await liveDimensionalStatements(query),{supabase}=await requireUser();
 const directory='frozenCenterNames' in source
  ?{data:source.frozenCenterNames.map(r=>({...r,organization_id:query.organization})),error:null}
  :await supabase.from('organization_cost_centers').select('id,organization_id,name').eq('organization_id',query.organization).limit(1001);
 if(directory.error||!Array.isArray(directory.data)||directory.data.length>1000||directory.data.some(r=>r.organization_id!==query.organization||!r.name))throw Error('REPORTING_CENTER_SOURCE_UNAVAILABLE');
 const names=new Map(directory.data.map(r=>[r.id,r.name]));
 if(names.size!==directory.data.length)throw Error('REPORTING_CENTER_SOURCE_UNAVAILABLE');
 const buckets=new Map<string|null,Record<string,string>>();
 for(const row of source.rows){
  if(branch!=='ALL'&&row.branchId!==(branch==='HQ'?null:branch))continue;
  if(row.centerId!==null&&!names.has(row.centerId))throw Error('REPORTING_CENTER_SOURCE_UNRESOLVED');
  const bucket=buckets.get(row.centerId)??{};
  for(const [metric,value]of Object.entries(row.statements.income))bucket[metric]=new Money(bucket[metric]??0).plus(value).toFixed(4);
  buckets.set(row.centerId,bucket);
 }
 // Metadata is never a substitute for the full money/permission recheck.
 assertStableFinancialReplay(source,await liveDimensionalStatements(query));
 const rows=[...buckets].map(([centerId,income])=>({centerId,name:centerId===null?null:names.get(centerId)!,income}));
 const companyIncome=Object.fromEntries(Object.keys(source.company.income).map(metric=>[metric,rows.reduce((sum,row)=>sum.plus(row.income[metric]),new Money(0)).toFixed(4)])) as typeof source.company.income;
 return{scope:'COST_CENTER_INCOME_ONLY',organizationId:query.organization,from:query.from,to:query.to,currency:source.currency,branch,rows,companyIncome};
}
