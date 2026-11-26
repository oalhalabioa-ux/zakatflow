import {z} from 'zod';
import {NextResponse} from 'next/server';
import {investmentWorkspace,investmentAction} from '../../../services/investments';
const headers={'Cache-Control':'no-store'};
function failure(e:unknown){
 const raw=e instanceof Error?e.message:String((e as {message?:string})?.message??'');
 const message=e instanceof z.ZodError?'INVESTMENT_INPUT_INVALID':/^[A-Z][A-Z_]+$/.test(raw)?raw:'INVESTMENT_FAILED';
 return NextResponse.json({error:message},{status:message==='UNAUTHORIZED'?401:/ACCESS|PERMISSION|DENIED/.test(message)?403:message==='INVESTMENT_FAILED'?500:400,headers});
}
export async function GET(request:Request){
 try{
  const q=new URL(request.url).searchParams;
  if([...q.keys()].some(key=>!['scope','organization_id','group'].includes(key)||q.getAll(key).length!==1)||q.has('group')&&!['0','1'].includes(q.get('group')!))throw Error('INVESTMENT_SCOPE_INVALID');
  return NextResponse.json(await investmentWorkspace({scope:q.get('scope')??'PERSONAL',organization_id:q.get('organization_id'),group:q.get('group')==='1'}),{headers});
 }catch(e){return failure(e);}
}
export async function POST(request:Request){try{return NextResponse.json(await investmentAction(await request.json()),{headers});}catch(e){return failure(e);}}
