import {isSameOriginRequest} from '../../../lib/request-origin';
import {NextResponse} from 'next/server';
import {z} from 'zod';
import {debtOperationAction,debtOperationWorkspace} from '../../../services/debt-operations';
const headers={'Cache-Control':'no-store'};
function fail(e:unknown){const m=e instanceof z.ZodError?'VALIDATION_FAILED':e instanceof Error?e.message:'';const error=/^[A-Z][A-Z_]+$/.test(m)?m:'DEBT_OPERATION_FAILED';return NextResponse.json({error},{status:error==='UNAUTHORIZED'?401:/DENIED/.test(error)?403:error==='DEBT_OPERATION_FAILED'?500:400,headers})}
export async function GET(r:Request){try{const q=new URL(r.url).searchParams;return NextResponse.json(await debtOperationWorkspace(q.get('organization_id')??'',q.get('target_id')??undefined),{headers})}catch(e){return fail(e)}}
export async function POST(r:Request){try{if(!isSameOriginRequest(r))return NextResponse.json({error:'ORIGIN_REQUIRED'},{status:403,headers});return NextResponse.json(await debtOperationAction(await r.json()),{headers})}catch(e){return fail(e)}}
