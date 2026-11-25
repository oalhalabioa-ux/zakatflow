import {NextRequest,NextResponse} from 'next/server';
import {createBudgetPlan,listBudgetPlans} from '@/services/budget-planning';
import {budgetError} from './errors';
export async function GET(request:NextRequest){try{const q=request.nextUrl.searchParams;return NextResponse.json(await listBudgetPlans({organization_id:q.get('organization_id'),group:q.get('group')==='1',fiscal_year:q.get('fiscal_year'),scenario:q.get('scenario'),cost_center:q.get('cost_center')}),{headers:{'Cache-Control':'no-store'}})}catch(error){return budgetError(error)}}
export async function POST(request:NextRequest){try{return NextResponse.json(await createBudgetPlan(await request.json()),{status:201,headers:{'Cache-Control':'no-store'}})}catch(error){return budgetError(error)}}
