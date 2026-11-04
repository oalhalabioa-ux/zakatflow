import {NextResponse} from 'next/server';
import {ZodError} from 'zod';
import {isSameOriginRequest} from '../../../../lib/request-origin';
import {fiscalContext,fiscalCommand,fiscalCandidates} from '../../../../services/financial-fiscal';
import {fiscalManagementContext} from '../../../../services/financial-fiscal-management';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff'};
function fail(error:unknown){const code=error instanceof Error?error.message:'FISCAL_UNAVAILABLE';const status=code==='UNAUTHORIZED'?401:/DENIED/.test(code)?403:error instanceof ZodError?422:/CONFLICT|CLOSED|CORRECTION|SUPERSEDED|IN_USE/.test(code)?409:422;return NextResponse.json({error:error instanceof ZodError?'FISCAL_INPUT_INVALID':/^(FISCAL|OPENING|REPORTING)_[A-Z_]+$/.test(code)||code==='UNAUTHORIZED'?code:'FISCAL_UNAVAILABLE'},{status,headers})}
export async function GET(request:Request){try{const q=new URL(request.url).searchParams;return NextResponse.json(await (q.get('action')==='management'?fiscalManagementContext(q.get('organization')):q.get('action')==='sources'?fiscalCandidates(q.get('organization'),q.get('fiscalStart')):fiscalContext(q.get('organization'))),{headers})}catch(error){return fail(error)}}
export async function POST(request:Request){try{if(!isSameOriginRequest(request))return NextResponse.json({error:'ORIGIN_REQUIRED'},{status:403,headers});if(!request.headers.get('content-type')?.startsWith('application/json'))throw Error('FISCAL_INPUT_INVALID');const body=await request.text();if(body.length>20000)throw Error('FISCAL_INPUT_INVALID');return NextResponse.json(await fiscalCommand(JSON.parse(body)),{headers})}catch(error){return fail(error)}}
