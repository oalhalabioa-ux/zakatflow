import {NextRequest,NextResponse} from 'next/server';
import {createBudgetPlan,listBudgetPlans} from '@/services/budget-planning';
export async function GET(request:NextRequest){try{const q=request.nextUrl.searchParams;return NextResponse.json(await listBudgetPlans({fiscal_year:q.get('fiscal_year'),organization_name:q.get('organization_name'),scenario:q.get('scenario'),cost_center:q.get('cost_center')}))}catch(error){return NextResponse.json({error:error instanceof Error?error.message:'UNKNOWN'},{status:500})}}
export async function POST(request:NextRequest){try{return NextResponse.json(await createBudgetPlan(await request.json()),{status:201})}catch(error){return NextResponse.json({error:error instanceof Error?error.message:'UNKNOWN'},{status:400})}}
