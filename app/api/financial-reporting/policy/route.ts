import {isSameOriginRequest} from '../../../../lib/request-origin';
import {NextResponse} from 'next/server';
import {ZodError} from 'zod';
import {readReportingPolicy,writeReportingPolicy} from '../../../../services/financial-reporting-policy';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff'};
function fail(e:unknown){const code=e instanceof Error?e.message:'REPORTING_UNAVAILABLE',status=/DISABLED/.test(code)?404:code==='UNAUTHORIZED'?401:/DENIED/.test(code)?403:/CONFLICT/.test(code)?409:e instanceof ZodError||/INVALID|DUPLICATE|REQUIRED/.test(code)?422:503;return NextResponse.json({error:/^(REPORTING|OPENING)_[A-Z_]+$/.test(code)?code:status===401?'UNAUTHORIZED':'REPORTING_UNAVAILABLE'},{status,headers})}
export async function GET(r:Request){try{const p=new URL(r.url).searchParams;if([...p.keys()].some(k=>!['organization','fiscalStart'].includes(k)||p.getAll(k).length!==1))throw Error('REPORTING_INPUT_INVALID');return NextResponse.json(await readReportingPolicy({organization:p.get('organization'),fiscalStart:p.get('fiscalStart')}),{headers})}catch(e){return fail(e)}}
export async function POST(r:Request){try{if(!isSameOriginRequest(r))return NextResponse.json({error:'ORIGIN_REQUIRED'},{status:403,headers});if(!r.headers.get('content-type')?.startsWith('application/json'))throw Error('REPORTING_INPUT_INVALID');const body=await r.text();if(body.length>2000000)throw Error('REPORTING_INPUT_INVALID');let q:unknown;try{q=JSON.parse(body)}catch{throw Error('REPORTING_INPUT_INVALID')}return NextResponse.json(await writeReportingPolicy(q),{headers})}catch(e){return fail(e)}}
