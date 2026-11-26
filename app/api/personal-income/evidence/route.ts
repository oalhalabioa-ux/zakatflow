import {NextResponse} from 'next/server';
import {z} from 'zod';
import {requireUser} from '@/services/auth';
import {isSameOriginRequest} from '@/lib/request-origin';

const headers={'Cache-Control':'private, no-store'};
const error=(status:number)=>NextResponse.json({error:'EVIDENCE_UNAVAILABLE'},{status,headers});
const upload=z.object({
  document_id:z.string().uuid(),request_id:z.string().uuid(),reference:z.string().trim().min(1).max(200),
  filename:z.string().trim().min(1).max(180),pdf_base64:z.string().max(1398104).regex(/^JVBERi0[A-Za-z0-9+/]*={0,2}$/)
}).strict();

export async function POST(req:Request){
  if(process.env.NEXT_PUBLIC_PERSONAL_INCOME!=='true')return error(404);
  if(!isSameOriginRequest(req))return error(403);
  try{
    const {supabase}=await requireUser();
    const payload=upload.safeParse(await req.json());
    if(!payload.success)return error(400);
    const {error:saveError}=await supabase.from('personal_income_evidence').insert(payload.data);
    if(saveError){
      if(saveError.code!=='23505')return error(400);
      const {data}=await supabase.from('personal_income_evidence').select('reference,filename,pdf_base64')
        .eq('request_id',payload.data.request_id).eq('document_id',payload.data.document_id).maybeSingle();
      if(!data||data.reference!==payload.data.reference||data.filename!==payload.data.filename||data.pdf_base64!==payload.data.pdf_base64)return error(409);
    }
    return NextResponse.json({saved:true},{headers});
  }catch{return error(400)}
}
export async function GET(req:Request){
  if(process.env.NEXT_PUBLIC_PERSONAL_INCOME!=='true')return error(404);
  try{
    const {supabase}=await requireUser();
    const params=new URL(req.url).searchParams;
    const {data,error:readError}=await supabase.from('personal_income_evidence').select('pdf_base64')
      .eq('document_id',z.string().uuid().parse(params.get('document'))).eq('request_id',z.string().uuid().parse(params.get('attachment'))).maybeSingle();
    if(readError||!data)return error(404);
    return new Response(Uint8Array.from(Buffer.from(data.pdf_base64,'base64')),{headers:{...headers,'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="evidence.pdf"','X-Content-Type-Options':'nosniff'}});
  }catch{return error(400)}
}
