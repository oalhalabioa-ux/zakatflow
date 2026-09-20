import {NextRequest,NextResponse} from 'next/server';
import {createBudgetPlan,listBudgetPlans} from '@/services/budget-planning';
export async function GET(){try{return NextResponse.json(await listBudgetPlans())}catch(error){return NextResponse.json({error:error instanceof Error?error.message:'UNKNOWN'},{status:500})}}
export async function POST(request:NextRequest){try{return NextResponse.json(await createBudgetPlan(await request.json()),{status:201})}catch(error){return NextResponse.json({error:error instanceof Error?error.message:'UNKNOWN'},{status:400})}}
