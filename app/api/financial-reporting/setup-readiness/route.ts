import {NextResponse} from 'next/server';
import {ZodError} from 'zod';
import {readFinancialSetupReadiness} from '../../../../services/financial-setup-readiness';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff'};
export async function GET(request:Request){
 try{
  const q=new URL(request.url).searchParams;
  if([...q.keys()].some(k=>!['organization','mode'].includes(k)||q.getAll(k).length!==1))
   throw Error('SETUP_INPUT_INVALID');
  const mode=q.get('mode');
  if(mode!==null&&mode!=='NEW'&&mode!=='EXISTING')throw Error('SETUP_INPUT_INVALID');
  return NextResponse.json(await readFinancialSetupReadiness({
   organization:q.get('organization'),mode,
  }),{headers});
 }catch(error){
  const code=error instanceof Error?error.message:'SETUP_UNAVAILABLE';
  const status=code==='UNAUTHORIZED'?401:code==='SETUP_ACCESS_DENIED'?403:
   error instanceof ZodError||code==='SETUP_INPUT_INVALID'?400:503;
  return NextResponse.json({error:status===401?'UNAUTHORIZED':
   status===403?'SETUP_ACCESS_DENIED':
   status===400?'SETUP_INPUT_INVALID':'SETUP_UNAVAILABLE'},{status,headers});
 }
}
