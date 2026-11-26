import {NextResponse} from 'next/server';
import {ZodError} from 'zod';
import {liveGroupV2Revaluation} from '../../../../services/financial-group-v2-revaluation';

export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store','Vary':'Cookie'};
export async function GET(request:Request){
 try{
  const params=new URL(request.url).searchParams;
  const allowed=new Set(['organization','from','to','member','journal','translation']);
  if([...params.keys()].some(key=>!allowed.has(key)||params.getAll(key).length!==1))throw Error('REPORTING_INPUT_INVALID');
  const query={organization:params.get('organization'),from:params.get('from'),to:params.get('to')};
  return NextResponse.json(await liveGroupV2Revaluation({query,member:params.get('member'),journal:params.get('journal'),translation:params.get('translation')??undefined}),{headers});
 }catch(error){
  const code=error instanceof Error?error.message:'';
  const status=code==='UNAUTHORIZED'?401:code.endsWith('_DENIED')?403:code.endsWith('_DISABLED')?404:
   error instanceof ZodError||code==='REPORTING_INPUT_INVALID'?400:code==='GROUP_V2_REVALUATION_REQUIRED'?422:503;
  return NextResponse.json({error:status===400?'REPORTING_INPUT_INVALID':status===503?'REPORTING_UNAVAILABLE':code},{status,headers});
 }
}
