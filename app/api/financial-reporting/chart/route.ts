import {NextResponse} from 'next/server';
import {ZodError} from 'zod';
import {isSameOriginRequest} from '../../../../lib/request-origin';
import {financialChartWorkspace,saveFinancialChartAccount} from '../../../../services/financial-chart';

export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff'};
function fail(error:unknown){
 const code=error instanceof Error?error.message:'CHART_UNAVAILABLE';
 const status=code==='UNAUTHORIZED'?401:/DENIED/.test(code)?403:/CONFLICT|IMMUTABLE|CHILDREN/.test(code)?409:422;
 return NextResponse.json({error:error instanceof ZodError?'CHART_INPUT_INVALID':/^CHART_[A-Z_]+$/.test(code)||code==='UNAUTHORIZED'?code:'CHART_UNAVAILABLE'},{status,headers});
}
export async function GET(request:Request){try{
 return NextResponse.json(await financialChartWorkspace(new URL(request.url).searchParams.get('organization')),{headers});
}catch(error){return fail(error)}}
export async function POST(request:Request){try{
 if(!isSameOriginRequest(request))return NextResponse.json({error:'ORIGIN_REQUIRED'},{status:403,headers});
 if(!request.headers.get('content-type')?.startsWith('application/json'))throw Error('CHART_INPUT_INVALID');
 const payload=await request.text();if(payload.length>8000)throw Error('CHART_INPUT_INVALID');
 return NextResponse.json(await saveFinancialChartAccount(JSON.parse(payload)),{headers});
}catch(error){return fail(error)}}
