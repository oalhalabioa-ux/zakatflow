import {NextResponse} from 'next/server';
import {configureFinancialBudget,financialBudgetContext,financialBudgetReport,financialBudgetSetup,financialBudgetDrilldown,financialBudgetConsolidated} from '@/services/financial-budget';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'no-store'};
function failure(error:unknown){const message=error instanceof Error?error.message:'FINANCIAL_BUDGET_FAILED';const status=message==='UNAUTHORIZED'?401:message==='FINANCIAL_BUDGET_QA_ONLY'?404:/DENIED|REQUIRED.*ACCESS|ACCESS_REQUIRED/.test(message)?403:400;return NextResponse.json({error:message},{status,headers});}
export async function GET(request:Request){try{const q=new URL(request.url).searchParams;let data:unknown;switch(q.get('action')??'context'){
 case 'context':data=await financialBudgetContext();break;
 case 'report':data=await financialBudgetReport(q.get('plan')??'');break;
 case 'setup':data=await financialBudgetSetup(q.get('plan')??'',q.get('organization')??'');break;
 case 'drilldown':data=await financialBudgetDrilldown(q.get('plan')??'');break;
 case 'consolidated':data=await financialBudgetConsolidated(q.get('holding')??'',Number(q.get('year')),q.get('scenario')??'BASE');break;
 default:throw new Error('INVALID_ACTION');}
 return NextResponse.json(data,{headers});}catch(error){return failure(error);}}
export async function POST(request:Request){try{if(new URL(request.url).origin!==request.headers.get('origin'))return NextResponse.json({error:'ORIGIN_REQUIRED'},{status:403,headers});return NextResponse.json({id:await configureFinancialBudget(await request.json())},{headers});}catch(error){return failure(error);}}
