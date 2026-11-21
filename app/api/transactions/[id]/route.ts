import {isSameOriginRequest} from '../../../../lib/request-origin';
import {z} from 'zod';
import {assetOperationWorkspace} from '@/services/asset-operation-workspace';
import {NextResponse} from 'next/server';
import {requireUser} from '@/services/auth';
import {withVoucherNumbers} from '../../../../services/voucher-numbers';
import {reverseTransaction} from '@/services/transactions';
import {personalSaleCorrectionSchema,personalSalePriceSchema,salePreflightSchema} from '../../../../lib/personal-sale-correction';
export async function GET(_:Request,{params}:{params:Promise<{id:string}>}){try{const{id}=await params;return NextResponse.json(await assetOperationWorkspace(id),{headers:{'Cache-Control':'no-store'}})}catch(e:any){return NextResponse.json({error:e.message},{status:e.message==='UNAUTHORIZED'?401:404})}}
export async function PATCH(req:Request,{params}:{params:Promise<{id:string}>}){try{if(!isSameOriginRequest(req))throw Error('ORIGIN_REQUIRED');const{id}=await params;z.string().uuid().parse(id);const p=z.object({notes:z.string().max(2000),expected_notes:z.string().max(2000)}).strict().parse(await req.json());const{supabase}=await requireUser();const{data,error}=await supabase.rpc('amend_asset_transaction_notes',{p_transaction_id:id,p_notes:p.notes,p_expected_notes:p.expected_notes});if(error)throw error;return NextResponse.json(data)}catch(e:any){return NextResponse.json({error:e.message},{status:e.message==='UNAUTHORIZED'?401:409})}}
export async function POST(req:Request,{params}:{params:Promise<{id:string}>}){
 if(!isSameOriginRequest(req))return NextResponse.json({error:'ORIGIN_REQUIRED'},{status:403});
 try{
  const id=z.string().uuid().parse((await params).id);
  const body=await req.json();
  if(body?.action==='reverse'){
   const result=await reverseTransaction(id);
   return NextResponse.json({id:result,status:'REVERSED'},{status:201});
  }
  if(body?.action==='sale-preflight'){
   const p=salePreflightSchema.parse(body);
   const {supabase}=await requireUser();
   const {data,error}=await supabase.rpc('personal_sale_preflight',{
    p_sale_id:id,p_asset_id:p.asset_account_id,p_destination_id:p.proceeds_account_id,p_date:p.transaction_date,
   });
   if(error)throw error;
   return NextResponse.json(await withVoucherNumbers(supabase,data),{headers:{'Cache-Control':'no-store'}});
  }
  if(body?.action==='amend-sale-price'){
   const p=personalSalePriceSchema.parse(body);
   const {supabase}=await requireUser();
   const {data,error}=await supabase.rpc('amend_personal_sale_price',{
    p_sale_id:id,p_request_id:p.request_id,p_expected_revision:p.expected_revision,
    p_unit_price:p.unit_price,p_reason:p.reason,
   });
   if(error)throw error;
   return NextResponse.json(data,{status:201});
  }
  const p=personalSaleCorrectionSchema.parse(body);
  const {supabase}=await requireUser();
  const {data,error}=await supabase.rpc('correct_personal_asset_sale',{
   p_sale_id:id,p_request_id:p.request_id,p_asset_id:p.asset_account_id,p_destination_id:p.proceeds_account_id,
   p_date:p.transaction_date,p_quantity:p.quantity,p_unit_price:p.unit_price,p_fx_rate:p.fx_rate,
   p_notes:p.notes,p_reason:p.reason,
  });
  if(error)throw error;
  return NextResponse.json(data,{status:201});
 }catch(e:any){
  if(e instanceof z.ZodError||e instanceof SyntaxError)return NextResponse.json({error:'SALE_CORRECTION_INVALID'},{status:400});
  return NextResponse.json({error:e.message},{status:e.message==='UNAUTHORIZED'?401:409});
 }
}
