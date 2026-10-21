import {NextResponse} from 'next/server';
import {z} from 'zod';
import {requireUser} from '@/services/auth';
import {resolveAssetEntryFx} from '@/services/asset-entry-fx';
export async function GET(request:Request){try{
 const {supabase,user}=await requireUser(),params=new URL(request.url).searchParams;
 const input=z.object({currency:z.string().regex(/^[A-Z]{3}$/),date:z.string().date(),organization_id:z.string().uuid().nullable()}).parse({currency:params.get('currency'),date:params.get('date'),organization_id:params.get('organization_id')});
 return NextResponse.json(await resolveAssetEntryFx(supabase,user.id,input.currency,input.date,input.organization_id),{headers:{'Cache-Control':'private, no-store'}});
 }catch(e:any){return NextResponse.json({error:e.message},{status:e.message==='UNAUTHORIZED'?401:400})}}
