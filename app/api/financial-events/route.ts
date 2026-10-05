import {NextResponse} from 'next/server';
import {executeFinancialEventAction,financialEventContext,financialEventWorkspace,financialEventDetail} from '@/services/financial-events';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'no-store'};
function failure(error:unknown){const message=error instanceof Error?error.message:'FINANCIAL_EVENT_FAILED';return NextResponse.json({error:message},{status:message==='UNAUTHORIZED'?401:message==='FINANCIAL_BUDGET_QA_ONLY'?404:/DENIED|CANNOT_APPROVE/.test(message)?403:400,headers});}
export async function GET(request:Request){try{const q=new URL(request.url).searchParams;const org=q.get('organization')??'';const action=q.get('action')??'context';let result:unknown;if(action==='context')result=await financialEventContext();else if(action==='workspace')result=await financialEventWorkspace(org);else if(action==='detail')result=await financialEventDetail(org,q.get('event')??'');else throw new Error('INVALID_ACTION');return NextResponse.json(result,{headers});}catch(error){return failure(error);}}
export async function POST(request:Request){try{if(request.headers.get('origin')!==new URL(request.url).origin)return NextResponse.json({error:'ORIGIN_REQUIRED'},{status:403,headers});return NextResponse.json({result:await executeFinancialEventAction(await request.json())},{headers});}catch(error){return failure(error);}}
