import {NextResponse} from 'next/server';
import {investmentWorkspace,investmentAction} from '@/services/investments';
function failure(e:unknown){const message=e instanceof Error?e.message:String((e as {message?:string})?.message??'INVESTMENT_FAILED');return NextResponse.json({error:message},{status:message==='UNAUTHORIZED'?401:400});}
export async function GET(){try{return NextResponse.json(await investmentWorkspace(),{headers:{'Cache-Control':'no-store'}});}catch(e){return failure(e);}}
export async function POST(request:Request){try{return NextResponse.json(await investmentAction(await request.json()));}catch(e){return failure(e);}}
