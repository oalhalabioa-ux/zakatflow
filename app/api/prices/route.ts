import {NextResponse} from 'next/server';
import {requireUser} from '@/services/auth';
import {priceSchema} from '@/lib/validation/schemas';
import {marketMetalPurity} from '@/lib/asset-ledger';
import {resolveAssetEntryFx} from '@/services/asset-entry-fx';
import {assetEditAvailability} from '@/services/assets';

const LIVE_URL='https://alyawmgold.com/api/v1/spot/latest?country=SA';

async function revalueMetalAssets(supabase: any, userId: string, price: any, assetId?: string) {
 if (!['GOLD','SILVER'].includes(price.asset_type)) return {updated:0};
 let query = supabase.from('asset_accounts').select('id,asset_type,metadata,updated_at,organization_id')
   .eq('asset_type',price.asset_type).eq('status','ACTIVE');
 query = assetId ? query.eq('id',assetId) : query.eq('user_id',userId);
 const {data:assets,error} = await query;
 if (error) throw error;
 let updated = 0;
 for (const asset of assets ?? []) {
  const previous = asset.metadata ?? {};
  if (previous.archived === true || previous.investment_id || previous.register_source) continue;
  if (assetId && previous.market_value_auto !== true) throw Error('ASSET_VALUATION_MODE_CHANGED');
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
    market_fx_rate:fx.rate,market_valuation_date:price.valuation_date,market_price_source:price.source,market_value_auto:true};
  const updatedAt = new Date(Math.max(Date.now(), Date.parse(asset.updated_at)+1)).toISOString();
  const {data:saved,error:updateError} = await supabase.from('asset_accounts').update({metadata,updated_at:updatedAt})
    .eq('id',asset.id).eq('updated_at',asset.updated_at).select('id').maybeSingle();
  if (updateError) throw updateError;
  if (!saved && assetId) throw Error('ASSET_EDIT_CONFLICT');
  if (saved) updated++;
 }
 return {updated};
}

async function liveSaudiPrices(){
 const r=await fetch(LIVE_URL,{cache:'no-store',signal:AbortSignal.timeout(8000)});
 if(!r.ok)throw new Error(`LIVE_PRICE_HTTP_${r.status}`);
 const d:any=await r.json();
 const currency=d?.country?.currency??'SAR';
 const gold=Number(d?.metals?.gold?.units?.gram);
 const silver=Number(d?.metals?.silver?.units?.gram);
 if(!(gold>0)||!(silver>0))throw new Error('LIVE_PRICE_INVALID');
 const quoteGold=d?.metals?.gold?.quoteRecordedAtUtc;
 const quoteSilver=d?.metals?.silver?.quoteRecordedAtUtc;
 const date=String(quoteGold??quoteSilver??new Date().toISOString()).slice(0,10);
 return {currency,gold,silver,date,quoteRecordedAtUtc:quoteGold??quoteSilver??null,goldStale:Boolean(d?.metals?.gold?.isQuoteStale),silverStale:Boolean(d?.metals?.silver?.isQuoteStale),fxStale:Boolean(d?.isExchangeRateStale)};
}

async function syncLive(supabase:any,userId:string,assetId?:string){
 const live=await liveSaudiPrices();
 const rows=[
  {asset_type:'GOLD',price_per_unit:live.gold,currency:live.currency,valuation_date:live.date,source:'ALYAWMGOLD_LIVE_SA'},
  {asset_type:'SILVER',price_per_unit:live.silver,currency:live.currency,valuation_date:live.date,source:'ALYAWMGOLD_LIVE_SA'}
 ];
 const results=[];
 for(const row of rows){
  const{data,error}=await supabase.from('market_prices').insert(row).select().single();
  if(error)throw error;
  const revaluation=await revalueMetalAssets(supabase,userId,data,assetId);
  results.push({...data,revaluation});
 }
 await supabase.from('audit_logs').insert({user_id:userId,entity_type:'market_price',action:'LIVE_SYNC_AND_REVALUE',new_data:{provider:'AlyawmGold',quoteRecordedAtUtc:live.quoteRecordedAtUtc,stale:{gold:live.goldStale,silver:live.silverStale,fx:live.fxStale},results}});
 if (assetId && !results.some(row=>row.revaluation.updated)) throw Error('ASSET_VALUATION_NOT_UPDATED');
 return {provider:'AlyawmGold',...live,results};
}

export async function GET(req: Request) {
 try {
  const {supabase,user} = await requireUser();
  const {searchParams} = new URL(req.url);
  if (searchParams.get('live') === '1') {
   const id = searchParams.get('asset_id');
   if (id) {
    const policy = await assetEditAvailability(id);
    if (policy.valuation_mode !== 'AUTOMATIC') {
     return NextResponse.json({error:'ASSET_AUTOMATIC_VALUATION_REQUIRED'},{status:403});
    }
   }
   return NextResponse.json(await syncLive(supabase,user.id,id ?? undefined),{headers:{'Cache-Control':'no-store'}});
  }
  let q = supabase.from('market_prices').select('*').order('valuation_date',{ascending:false}).order('created_at',{ascending:false}).limit(200);
  if(searchParams.get('asset_type')) q = q.eq('asset_type',searchParams.get('asset_type')!);
  const {data,error} = await q;
  if(error) throw error;
  return NextResponse.json(data ?? []);
 } catch (error) {
  const code = (error as {message?:string})?.message;
  return NextResponse.json({error:code},{status:code==='ASSET_NOT_FOUND'?404:code==='ASSET_EDIT_CONFLICT'?409:400});
 }
}
export async function POST(req:Request){try{const {supabase,user}=await requireUser();const p=priceSchema.parse(await req.json());const {data,error}=await supabase.from('market_prices').insert(p).select().single();if(error)throw error;const revaluation=await revalueMetalAssets(supabase,user.id,data);await supabase.from('audit_logs').insert({user_id:user.id,entity_type:'market_price',entity_id:data.id,action:'CREATE_AND_REVALUE',new_data:{price:data,revaluation}});return NextResponse.json({...data,revaluation},{status:201})}catch(e:any){return NextResponse.json({error:e.message},{status:400})}}
