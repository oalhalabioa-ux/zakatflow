import {NextResponse} from 'next/server';
import {z} from 'zod';
import {requireUser} from '@/services/auth';
const schema=z.object({asset_id:z.string().uuid(),request_id:z.string().uuid(),operation:z.enum(['DEPRECIATION','SALE','DISPOSAL']),date:z.string().date(),quantity:z.number().finite().nonnegative(),amount:z.number().finite().nonnegative(),vat_amount:z.number().finite().nonnegative().default(0),counterparty_id:z.string().uuid().nullable(),due_date:z.string().date().nullable()});
export async function POST(req:Request){try{const p=schema.parse(await req.json());const{supabase}=await requireUser();const{asset_id,request_id,...payload}=p;const{data,error}=await supabase.rpc('prepare_asset_lifecycle',{p_asset_id:asset_id,p_payload:payload,p_request_id:request_id});if(error)throw error;return NextResponse.json(data,{status:201});}catch(e:any){return NextResponse.json({error:e.message},{status:e.message==='UNAUTHORIZED'?401:400});}}
