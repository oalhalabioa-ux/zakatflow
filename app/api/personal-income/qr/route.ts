import QRCode from 'qrcode';
import {requireUser} from '@/services/auth';
import {createZatcaPhaseOneQrPayload} from '@/lib/zatca-phase-one-qr';
export async function GET(req:Request){
  if(process.env.NEXT_PUBLIC_PERSONAL_INCOME!=='true')return new Response(null,{status:404});
  const {supabase,user}=await requireUser();
  const {data,error}=await supabase.from('personal_income_documents')
    .select('seller_name,seller_vat_number,issued_at,gross_amount,tax_amount')
    .eq('owner_id',user.id).eq('kind','SIMPLIFIED_INVOICE').eq('id',new URL(req.url).searchParams.get('id')).maybeSingle();
  if(error||!data)return new Response(null,{status:404});
  const local=new Date(Date.parse(data.issued_at)+3*3600_000).toISOString();
  const payload=createZatcaPhaseOneQrPayload({sellerName:data.seller_name,sellerVatNumber:data.seller_vat_number,
    issueDate:local.slice(0,10),issueTime:local.slice(11,19),totalWithVat:data.gross_amount,vatTotal:data.tax_amount});
  return new Response(Uint8Array.from(await QRCode.toBuffer(payload)),{headers:{'Content-Type':'image/png','Cache-Control':'private, no-store'}});
}
