import {NextResponse} from 'next/server';
import {ZodError} from 'zod';
import {liveStatementContext,liveStatementSource} from '../../../../services/financial-statement-live';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff'};
export async function GET(request:Request){try{const q=new URL(request.url).searchParams;if([...q.keys()].some(k=>!['action','organization','from','to'].includes(k)||q.getAll(k).length!==1))throw Error('REPORTING_INPUT_INVALID');
 if(q.get('action')==='context')return NextResponse.json(await liveStatementContext(),{headers});
 if(q.get('action')!=='statements')throw Error('REPORTING_INPUT_INVALID');
 return NextResponse.json(await liveStatementSource({organization:q.get('organization'),from:q.get('from'),to:q.get('to')}),{headers});
 }catch(e){const code=e instanceof Error?e.message:'REPORTING_UNAVAILABLE',status=/DISABLED/.test(code)?404:code==='UNAUTHORIZED'?401:/DENIED/.test(code)?403:e instanceof ZodError||/INVALID/.test(code)?400:503;return NextResponse.json({error:/^REPORTING_[A-Z_]+$/.test(code)?code:status===401?'UNAUTHORIZED':'REPORTING_UNAVAILABLE'},{status,headers})}}
