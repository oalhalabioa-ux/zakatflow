import {NextResponse} from 'next/server';
import {z,ZodError} from 'zod';
import {requireUser} from '../../../../../services/auth';
import {isSameOriginRequest} from '../../../../../lib/request-origin';
const command=z.object({organization:z.string().uuid(),name:z.string().trim().min(1).max(120),active:z.boolean(),expectedName:z.string().min(1).max(120),expectedActive:z.boolean(),reason:z.string().trim().min(3).max(500)}).strict();
const headers={'Cache-Control':'private, no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff'};
export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}){
 try{
  if(!isSameOriginRequest(request))return NextResponse.json({error:'ORIGIN_REQUIRED'},{status:403,headers});
  const {id}=await params;z.string().uuid().parse(id);const p=command.parse(await request.json()),{supabase}=await requireUser();
  const {data,error}=await supabase.rpc('update_financial_cash_account',{p_org:p.organization,p_id:id,p_name:p.name,p_active:p.active,p_expected_name:p.expectedName,p_expected_active:p.expectedActive,p_reason:p.reason});
  if(error)throw Error(error.message.match(/(?:FISCAL|CHART)_[A-Z_]+/)?.[0]??'FISCAL_CASH_UPDATE_FAILED');
  return NextResponse.json(data,{headers});
 }catch(error){
  const code=error instanceof ZodError?'FISCAL_CASH_INPUT_INVALID':error instanceof Error?error.message:'FISCAL_CASH_UPDATE_FAILED';
  return NextResponse.json({error:/^(FISCAL|CHART)_[A-Z_]+$/.test(code)||code==='UNAUTHORIZED'?code:'FISCAL_CASH_UPDATE_FAILED'},{status:code==='UNAUTHORIZED'?401:/DENIED/.test(code)?403:/CONFLICT|IMMUTABLE|NONZERO|CLOSED|CORRECTION|REFERENCED/.test(code)?409:422,headers});
 }
}
