import {NextResponse} from 'next/server';
import {z} from 'zod';
import {payableDetail,actOnPayable} from '../../../../services/payables';
const headers={'Cache-Control':'no-store'};
function failure(e:unknown){const message=e instanceof z.ZodError?'VALIDATION_FAILED':e&&typeof e==='object'&&'message'in e?String(e.message):'';const code=/^[A-Z][A-Z_]+$/.test(message)?message:'PAYABLE_LOAD_FAILED';return NextResponse.json({error:code},{status:code==='UNAUTHORIZED'?401:/DENIED|ACCESS/.test(code)?403:code==='PAYABLE_LOAD_FAILED'?500:400,headers});}
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){try{const {id}=await params;return NextResponse.json(await payableDetail(new URL(request.url).searchParams.get('organization_id')??'',id),{headers});}catch(e){return failure(e);}}
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){try{if(request.headers.get('origin')!==new URL(request.url).origin)return NextResponse.json({error:'ORIGIN_REQUIRED'},{status:403,headers});const {id}=await params;return NextResponse.json(await actOnPayable(new URL(request.url).searchParams.get('organization_id')??'',id,await request.json()),{headers});}catch(e){return failure(e);}}
