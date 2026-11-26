import {NextResponse} from 'next/server';
import {isSameOriginRequest} from '@/lib/request-origin';
import {z} from 'zod';
import {requireUser} from '@/services/auth';

const label=z.string().trim().min(1).max(200);
const amount=z.string().regex(/^\d{1,12}(\.\d{1,2})?$/);
const profile=z.object({action:z.literal('PROFILE'),seller_name:label,vat_number:z.string().regex(/^3\d{13}3$/).nullable(),effective_from:z.string().date().nullable()}).strict();
const document=z.object({action:z.enum(['INVOICE','EVIDENCE','SIMPLIFIED']),request:z.string().uuid(),date:z.string().date(),customer:label,description:z.string().trim().min(1).max(500),reference:label.nullable(),net:amount,tax:amount}).strict();
function json(value:unknown,status=200){return NextResponse.json(value,{status,headers:{'Cache-Control':'private, no-store'}})}
function failure(error:unknown){return error instanceof Error && error.message==='UNAUTHORIZED'?json({error:'UNAUTHORIZED'},401):json({error:'INCOME_UNAVAILABLE'},500)}
export async function GET(){
  if(process.env.NEXT_PUBLIC_PERSONAL_INCOME!=='true')return json({error:'UNAVAILABLE'},404);
  try{
    const {supabase,user}=await requireUser();
    const [seller,records,issuer]=await Promise.all([
      supabase.from('personal_income_profiles').select('seller_name,vat_number,effective_from').eq('owner_id',user.id).maybeSingle(),
      supabase.from('personal_income_documents').select('id,serial,kind,document_date,seller_name,seller_vat_number,customer,description,source_reference,net_amount,tax_amount,gross_amount,invoice_number,issued_at,seller_address,receivable_id,personal_income_evidence(request_id,reference,filename)').eq('owner_id',user.id).order('serial',{ascending:false}).limit(100),
      supabase.from('personal_income_issuers').select('vat_number,valid_from,valid_until').eq('owner_id',user.id).maybeSingle()
    ]);
    if(seller.error||records.error||issuer.error)return json({error:'INCOME_UNAVAILABLE'},500);
    return json({issuer:issuer.data,profile:seller.data,documents:records.data});
  }catch(error){return failure(error)}
}
export async function POST(req:Request){
  if(!isSameOriginRequest(req))return json({error:'ORIGIN_REQUIRED'},403);
  if(process.env.NEXT_PUBLIC_PERSONAL_INCOME!=='true')return json({error:'UNAVAILABLE'},404);
  try{
    const {supabase,user}=await requireUser();
    const parsed=z.union([profile,document]).safeParse(await req.json().catch(()=>null));
    if(!parsed.success)return json({error:'INVALID_DOCUMENT'},400);
    const body=parsed.data;
    if(body.action==='PROFILE'){
      if(Boolean(body.vat_number)!==Boolean(body.effective_from))return json({error:'INVALID_PROFILE'},400);
      const {error}=await supabase.from('personal_income_profiles').upsert({owner_id:user.id,seller_name:body.seller_name,vat_number:body.vat_number,effective_from:body.effective_from});
      if(error)return json({error:'PROFILE_SAVE_FAILED'},400);
      return json({saved:true});
    }
    const {data,error}=await supabase.rpc('record_personal_income_document',{p_request:body.request,p_mode:body.action,p_date:body.date,p_customer:body.customer,p_description:body.description,p_reference:body.reference,p_net:body.net,p_tax:body.tax});
    if(error){
      const code=['VAT_REGISTRATION_REQUIRED','PROFILE_REQUIRED','REQUEST_CONFLICT'].includes(error.message)?error.message:error.code==='23505'?'REFERENCE_EXISTS':'INVALID_DOCUMENT';
      return json({error:code},code==='REFERENCE_EXISTS'||code==='REQUEST_CONFLICT'?409:400);
    }
    return json({id:data.id,kind:data.kind});
  }catch(error){return failure(error)}
}
