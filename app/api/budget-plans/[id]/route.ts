import {NextRequest,NextResponse} from 'next/server';
import {getBudgetPlan,submitBudgetPlan,updateBudgetPlan} from '@/services/budget-planning';
import {budgetError} from '../errors';
export async function GET(request:NextRequest,{params}:{params:Promise<{id:string}>}){try{return NextResponse.json(await getBudgetPlan((await params).id,request.nextUrl.searchParams.get('organization_id')),{headers:{'Cache-Control':'no-store'}})}catch(error){return budgetError(error,404)}}
export async function PUT(request:NextRequest,{params}:{params:Promise<{id:string}>}){try{return NextResponse.json(await updateBudgetPlan((await params).id,await request.json()),{headers:{'Cache-Control':'no-store'}})}catch(error){return budgetError(error)}}
export async function PATCH(request:NextRequest,{params}:{params:Promise<{id:string}>}){try{const{id}=await params;const{status,organization_id}=await request.json();if(status!=='IN_REVIEW'&&status!=='APPROVED')return NextResponse.json({error:'INVALID_STATUS'},{status:400});return NextResponse.json(await submitBudgetPlan(id,status,organization_id),{headers:{'Cache-Control':'no-store'}})}catch(error){return budgetError(error)}}
