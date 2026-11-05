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

export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
 try{
  const {id}=await params;z.string().uuid().parse(id);const q=new URL(request.url).searchParams,org=z.string().uuid().parse(q.get('organization')),date=q.get('date');if(date)z.string().date().parse(date);
  const {supabase}=await requireUser();const result=await supabase.rpc('financial_cash_opening_detail',{p_org:org,p_id:id,p_date:date||null});if(result.error)throw Error(result.error.message.match(/FISCAL_[A-Z_]+/)?.[0]??'FISCAL_CASH_LOAD_FAILED');
  const {financialRegister}=await import('../../../../../services/financial-register');const register=await financialRegister('ORGANIZATION',org,false);
  const s=result.data;const account=register.accounts.find(a=>a.id===id)??{id,name:s.name,type:s.accountType,currency:s.currency,nativeCurrency:s.currency,balance:Number(s.balance),restricted:Number(s.restricted),uncleared:Number(s.uncleared),baseCurrency:s.baseCurrency,baseBalance:Number(s.baseBalance),organizationId:org,entityId:s.entityId,source:'LIQUIDITY',openingDate:s.date};return NextResponse.json({opening:s,account,movements:register.cashMovements.filter(m=>m.accountId===id)},{headers});
 }catch(error){return cashError(error)}
}
const openingCommand=z.object({organization:z.string().uuid(),date:z.string().date(),amount:z.number().finite().min(-1e12).max(1e12),fx:z.number().finite().positive().max(1e6),token:z.string().regex(/^[a-f0-9]{32}$/),reason:z.string().trim().min(3).max(500)}).strict();
function cashError(error:unknown){const code=error instanceof ZodError?'FISCAL_CASH_INPUT_INVALID':error instanceof Error?error.message:'FISCAL_CASH_LOAD_FAILED';return NextResponse.json({error:/^FISCAL_[A-Z_]+$/.test(code)||code==='UNAUTHORIZED'?code:'FISCAL_CASH_LOAD_FAILED'},{status:code==='UNAUTHORIZED'?401:/DENIED/.test(code)?403:/CONFLICT|CLOSED|CORRECTION|REVIEW/.test(code)?409:422,headers})}
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 try{
  if(!isSameOriginRequest(request))return NextResponse.json({error:'ORIGIN_REQUIRED'},{status:403,headers});
  const {id}=await params;z.string().uuid().parse(id);const p=openingCommand.parse(await request.json()),{supabase}=await requireUser();
  const {data,error}=await supabase.rpc('correct_financial_cash_opening',{p_org:p.organization,p_id:id,p_date:p.date,p_amount:p.amount,p_fx:p.fx,p_token:p.token,p_reason:p.reason});if(error)throw Error(error.message.match(/FISCAL_[A-Z_]+/)?.[0]??'FISCAL_CASH_UPDATE_FAILED');return NextResponse.json(data,{headers});
 }catch(error){return cashError(error)}
}
