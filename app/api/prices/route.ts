import {NextResponse} from 'next/server';
import {requireUser} from '@/services/auth';
import {priceSchema} from '@/lib/validation/schemas';
import {marketMetalPurity} from '@/lib/asset-ledger';
import {resolveAssetEntryFx} from '@/services/asset-entry-fx';

async function revalueMetalAssets(supabase: any, userId: string, price: any) {
 if (!['GOLD','SILVER'].includes(price.asset_type)) return {updated:0};
 const {data:assets,error} = await supabase.from('asset_accounts').select('id,asset_type,metadata,updated_at,organization_id')
   .eq('asset_type',price.asset_type).eq('status','ACTIVE').eq('user_id',userId);
 if (error) throw error;
 let updated = 0;
 for (const asset of assets ?? []) {
  const previous = asset.metadata ?? {};
  if (previous.archived === true || previous.investment_id || previous.register_source) continue;
  const {data:lots,error:lotError} = await supabase.from('lots').select('original_quantity,metadata').eq('asset_account_id',asset.id);
  if (lotError) throw lotError;
  const original = (lots ?? []).filter((lot:any)=>!lot.metadata?.recognition_pending)
    .reduce((quantity:number,lot:any)=>quantity+Number(lot.original_quantity),0);
  const quantity = original || Number(previous.quantity || previous.weight_g || Number(previous.weight_kg ?? 0)*1000);
  if (quantity <= 0) continue;
  const fx = await resolveAssetEntryFx(supabase,userId,price.currency,price.valuation_date,asset.organization_id);
  const value = quantity*Number(price.price_per_unit)*marketMetalPurity(asset);
  const metadata = {...previous,market_value:value,estimated_value:value,
    market_price_per_unit:Number(price.price_per_unit),market_price_currency:price.currency,
    market_fx_rate:fx.rate,market_valuation_date:price.valuation_date,market_price_source:price.source,market_price_source_mode:'MANUAL',market_value_auto:true};
  const updatedAt = new Date(Math.max(Date.now(), Date.parse(asset.updated_at)+1)).toISOString();
  const {data:saved,error:updateError} = await supabase.from('asset_accounts').update({metadata,updated_at:updatedAt})
    .eq('id',asset.id).eq('updated_at',asset.updated_at).select('id').maybeSingle();
  if (updateError) throw updateError;
  if (saved) updated++;
 }
 return {updated};
}

export async function GET(req: Request) {
 try {
  const {supabase} = await requireUser();
  const {searchParams} = new URL(req.url);
  // Provider refresh stays off until explicit scope settings and a zero-cost
  // provider policy are available. Legacy quote metadata is never consent.
  if (searchParams.get('live') === '1') {
   return NextResponse.json({error:'GLOBAL_METAL_PRICE_LINK_DISABLED'},
     {status:403,headers:{'Cache-Control':'no-store'}});
  }
  let q = supabase.from('market_prices').select('*').order('valuation_date',{ascending:false}).order('created_at',{ascending:false}).limit(200);
  if(searchParams.get('asset_type')) q = q.eq('asset_type',searchParams.get('asset_type')!);
  const {data,error} = await q;
  if(error) throw error;
  return NextResponse.json(data ?? []);
 } catch (error) {
  const code = (error as {message?:string})?.message;
  return NextResponse.json({error:code},{status:code==='UNAUTHORIZED'?401:400});
 }
}
export async function POST(req:Request){try{const {supabase,user}=await requireUser();const p=priceSchema.parse(await req.json());const {data,error}=await supabase.from('market_prices').insert(p).select().single();if(error)throw error;const revaluation=await revalueMetalAssets(supabase,user.id,data);await supabase.from('audit_logs').insert({user_id:user.id,entity_type:'market_price',entity_id:data.id,action:'CREATE_AND_REVALUE',new_data:{price:data,revaluation}});return NextResponse.json({...data,revaluation},{status:201})}catch(e:any){return NextResponse.json({error:e.message},{status:400})}}
