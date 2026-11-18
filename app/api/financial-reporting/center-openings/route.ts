import {NextResponse} from 'next/server';
import {z,ZodError} from 'zod';
import {isSameOriginRequest} from '../../../../lib/request-origin';
import {centerOpeningPilotConfigured,centerOpeningsEnabled} from '../../../../services/financial-center-report-rollout';
import {dimensionalOpeningContext,dimensionalOpeningCommand,dimensionalOpeningEditorContext} from '../../../../services/financial-dimensional-opening-workspace';

export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff'};
function failed(error:unknown){
 const code=error instanceof Error?error.message:'DIMENSION_OPENING_UNAVAILABLE';
 const status=code==='OPENING_DISABLED'?404:code==='UNAUTHORIZED'?401:/DENIED/.test(code)?403:
  /CONFLICT|CHANGED/.test(code)?409:error instanceof ZodError||/INVALID|INCOMPLETE|UNBALANCED|MISMATCH|REQUIRED|DUPLICATE|UNRECOGNIZED/.test(code)?422:503;
 const safe=error instanceof ZodError?'DIMENSION_OPENING_INPUT_INVALID':/^DIMENSION_OPENING_[A-Z_]+$/.test(code)?code:
  status===401?'UNAUTHORIZED':status===404?'OPENING_DISABLED':'DIMENSION_OPENING_UNAVAILABLE';
 return NextResponse.json({error:safe},{status,headers});
}
export async function GET(request:Request){
 try{
  const q=new URL(request.url).searchParams;
  if(!centerOpeningsEnabled(q.get('organization')))throw Error('OPENING_DISABLED');
  if([...q.keys()].some(key=>!['organization','fiscalStart','action'].includes(key)||q.getAll(key).length!==1))
    throw Error('DIMENSION_OPENING_INPUT_INVALID');
  const editor=q.get('action')==='editor';
  if(q.size!==(editor?3:2)||(!editor&&q.has('action')))throw Error('DIMENSION_OPENING_INPUT_INVALID');
  const input={organization:q.get('organization'),fiscalStart:q.get('fiscalStart')};
  return NextResponse.json(await (editor?dimensionalOpeningEditorContext(input):dimensionalOpeningContext(input)),{headers});
 }catch(e){return failed(e)}
}
export async function POST(request:Request){
 try{
  if(!centerOpeningPilotConfigured()&&!centerOpeningsEnabled(null))throw Error('OPENING_DISABLED');
  if(!isSameOriginRequest(request))return NextResponse.json({error:'ORIGIN_REQUIRED'},{status:403,headers});
  if(!request.headers.get('content-type')?.startsWith('application/json'))throw Error('DIMENSION_OPENING_INPUT_INVALID');
  const source=await request.text();
  if(source.length>2000000)throw Error('DIMENSION_OPENING_INPUT_INVALID');
  let parsed:unknown;
  try{parsed=JSON.parse(source)}catch{throw Error('DIMENSION_OPENING_INPUT_INVALID')}
  if(centerOpeningPilotConfigured()){
   const command=z.object({action:z.enum(['save','approve']),organization:z.string().optional(),scope:z.object({organization:z.string()}).passthrough().optional()}).passthrough().parse(parsed);
   if(!centerOpeningsEnabled((command.action==='approve'?command.scope?.organization:command.organization)??null))
    throw Error('OPENING_DISABLED');
  }
  return NextResponse.json(await dimensionalOpeningCommand(parsed),{headers});
 }catch(e){return failed(e)}
}
