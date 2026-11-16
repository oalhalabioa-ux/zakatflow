import {isSameOriginRequest} from '../../../../lib/request-origin';
import {NextResponse} from 'next/server';
import {ZodError} from 'zod';
import {openingContext,readOpening,writeOpening} from '../../../../services/financial-opening-workspace';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff'};
function failed(error:unknown){const code=error instanceof Error?error.message:'OPENING_UNAVAILABLE';const status=code==='OPENING_DISABLED'?404:code==='UNAUTHORIZED'?401:/DENIED/.test(code)?403:/CONFLICT|CHANGED/.test(code)?409:error instanceof ZodError||/INVALID|INCOMPLETE|UNBALANCED|REQUIRED/.test(code)?422:503;return NextResponse.json({error:status===503?'OPENING_UNAVAILABLE':error instanceof ZodError?'OPENING_INPUT_INVALID':code},{status,headers})}
export async function GET(request:Request){try{const p=new URL(request.url).searchParams;if([...p.keys()].some(k=>!['action','organization','fiscalStart'].includes(k)||p.getAll(k).length!==1))throw Error('OPENING_INPUT_INVALID');if(p.get('action')==='context')return NextResponse.json(await openingContext(),{headers});return NextResponse.json(await readOpening({organization:p.get('organization'),fiscalStart:p.get('fiscalStart')}),{headers})}catch(e){return failed(e)}}
export async function POST(request:Request){try{
 if(!isSameOriginRequest(request))return NextResponse.json({error:'ORIGIN_REQUIRED'},{status:403,headers});
 if(!request.headers.get('content-type')?.startsWith('application/json'))throw Error('OPENING_INPUT_INVALID');
 const body=await request.text();if(body.length>2000000)throw Error('OPENING_INPUT_INVALID');let value:unknown;try{value=JSON.parse(body)}catch{throw Error('OPENING_INPUT_INVALID')}
 return NextResponse.json(await writeOpening(value),{headers});
 }catch(e){return failed(e)}}
