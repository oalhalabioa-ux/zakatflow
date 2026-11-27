import {NextResponse} from 'next/server';
import {ZodError} from 'zod';
import {classifyPersonalActivity,readPersonalCutoffSources} from '../../../../services/reporting-source-contracts';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store','Vary':'Cookie'};
function failed(error:unknown){
 const code=error instanceof Error?error.message:'REPORTING_CONTRACT_UNAVAILABLE';
 const status=code==='UNAUTHORIZED'?401:code.endsWith('_DENIED')?403:error instanceof ZodError?400:code==='REPORTING_CONTRACT_UNAVAILABLE'?503:409;
 return NextResponse.json({error:status===400?'PERSONAL_SOURCE_INPUT_INVALID':code},{status,headers});
}
export async function GET(req:Request){
 try{
  const params=new URL(req.url).searchParams;
  if([...params.keys()].some(key=>params.getAll(key).length!==1))return NextResponse.json({error:'PERSONAL_SOURCE_INPUT_INVALID'},{status:400,headers});
  return NextResponse.json(await readPersonalCutoffSources(Object.fromEntries(params)),{headers});
 }catch(error){return failed(error);}
}
export async function POST(req:Request){
 try{return NextResponse.json(await classifyPersonalActivity(await req.json()),{headers});}
 catch(error){return failed(error);}
}
