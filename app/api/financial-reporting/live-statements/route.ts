import {liveGroupSourceReview} from '../../../../services/financial-group-source-review';
import {liveCostCenterIncome} from '../../../../services/financial-cost-center-income';
import {NextResponse} from 'next/server';
import {liveBranchReport,liveReportBranches} from '../../../../services/financial-branch-report';
import {ZodError} from 'zod';
import {liveStatementContext,liveStatementSource} from '../../../../services/financial-statement-live';
import {liveScopeReadiness} from '../../../../services/financial-scope-readiness';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff'};
export async function GET(request:Request){try{const q=new URL(request.url).searchParams;if([...q.keys()].some(k=>!['action','organization','from','to','scope','branch'].includes(k)||q.getAll(k).length!==1))throw Error('REPORTING_INPUT_INVALID');
 if(q.get('action')==='context'){if([...q.keys()].some(k=>k!=='action'))throw Error('REPORTING_INPUT_INVALID');return NextResponse.json(await liveStatementContext(),{headers});}
 if(q.get('action')==='branches'){if([...q.keys()].some(k=>!['action','organization'].includes(k)))throw Error('REPORTING_INPUT_INVALID');return NextResponse.json(await liveReportBranches(q.get('organization')),{headers});}
 if(q.get('action')==='scope-readiness'&&q.has('branch'))throw Error('REPORTING_INPUT_INVALID');
 if(q.get('action')==='scope-readiness')return NextResponse.json(await liveScopeReadiness({organization:q.get('organization'),from:q.get('from'),to:q.get('to'),scope:q.get('scope')}),{headers});
 if(q.get('action')==='group-review'){if(q.has('branch')||q.has('scope'))throw Error('REPORTING_INPUT_INVALID');return NextResponse.json(await liveGroupSourceReview({organization:q.get('organization'),from:q.get('from'),to:q.get('to')}),{headers});}
 if(q.get('action')==='cost-center-income'){if(q.has('scope'))throw Error('REPORTING_INPUT_INVALID');return NextResponse.json(await liveCostCenterIncome({organization:q.get('organization'),from:q.get('from'),to:q.get('to')},q.has('branch')?q.get('branch'):undefined),{headers});}
 if(q.get('action')!=='statements')throw Error('REPORTING_INPUT_INVALID');
 if(q.has('scope'))throw Error('REPORTING_INPUT_INVALID');
 if(q.has('branch'))return NextResponse.json(await liveBranchReport({organization:q.get('organization'),from:q.get('from'),to:q.get('to')},q.get('branch')),{headers});
 return NextResponse.json(await liveStatementSource({organization:q.get('organization'),from:q.get('from'),to:q.get('to')}),{headers});
 }catch(e){
  const code=e instanceof Error?e.message:'REPORTING_UNAVAILABLE';
  // Emit a code-only diagnostic in isolated QA, never in Production. No
  // organization IDs, document contents, SQL arguments or credentials.
  if(process.env.VERCEL_ENV!=='production'&&process.env.FINANCIAL_SOURCE_INTEGRITY_DIAGNOSTICS==='true')
   console.warn('REPORTING_QA_DIAGNOSTIC_CODE',code);
  // Corrupt or unverified source data is a SERVER integrity failure, not a
  // malformed user request. Do not send a 400 for *_SOURCE_*_INVALID.
  const inputInvalid=e instanceof ZodError||code==='REPORTING_INPUT_INVALID'||code==='REPORTING_PERIOD_INVALID';
  const status=/DISABLED/.test(code)?404:code==='UNAUTHORIZED'?401:/DENIED/.test(code)?403:inputInvalid?400:503;
  return NextResponse.json({error:/^REPORTING_[A-Z_]+$/.test(code)?code:status===401?'UNAUTHORIZED':'REPORTING_UNAVAILABLE'},{status,headers});
 }}
