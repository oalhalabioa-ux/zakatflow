import {NextResponse} from 'next/server';
import {requireUser} from '@/services/auth';
import {priceSchema} from '@/lib/validation/schemas';

const LIVE_URL='https://alyawmgold.com/api/v1/spot/latest?country=SA';

function purity(asset:any){const m=asset.metadata??{};if(asset.asset_type==='GOLD'){const k=Number(m.karat??24);return k>0&&k<=24?k/24:1}const raw=Number(m.purity??m.karat??999);const p=raw>1?raw/1000:raw;return p>0&&p<=1?p:1}
function quantityGrams(asset:any){const m=asset.metadata??{};if(Number(m.quantity)>0)return Number(m.quantity);if(Number(m.weight_g)>0)return Number(m.weight_g);if(Number(m.weight_kg)>0)return Number(m.weight_kg)*1000;return 0}
async function revalueMetalAssets(supabase:any,userId:string,price:any){if(!['GOLD','SILVER'].includes(price.asset_type))return{updated:0};const{data:assets,error}=await supabase.from('asset_accounts').select('id,asset_type,metadata,status').eq('user_id',userId).eq('asset_type',price.asset_type).eq('status','ACTIVE');if(error)throw error;let updated=0;for(const asset of assets??[]){const q=quantityGrams(asset);if(q<=0)continue;const value=q*Number(price.price_per_unit)*purity(asset);const metadata={...(asset.metadata??{}),market_value:value,estimated_value:value,market_price_per_unit:Number(price.price_per_unit),market_price_currency:price.currency,market_valuation_date:price.valuation_date,market_price_source:price.source,market_value_auto:true};const{error:ue}=await supabase.from('asset_accounts').update({metadata}).eq('id',asset.id).eq('user_id',userId);if(ue)throw ue;updated++}return{updated}}

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

async function syncLive(supabase:any,userId:string){
 const live=await liveSaudiPrices();
 const rows=[
  {asset_type:'GOLD',price_per_unit:live.gold,currency:live.currency,valuation_date:live.date,source:'ALYAWMGOLD_LIVE_SA'},
  {asset_type:'SILVER',price_per_unit:live.silver,currency:live.currency,valuation_date:live.date,source:'ALYAWMGOLD_LIVE_SA'}
 ];
 const results=[];
 for(const row of rows){
  const{data,error}=await supabase.from('market_prices').insert(row).select().single();
  if(error)throw error;
  const revaluation=await revalueMetalAssets(supabase,userId,data);
  results.push({...data,revaluation});
 }
 await supabase.from('audit_logs').insert({user_id:userId,entity_type:'market_price',action:'LIVE_SYNC_AND_REVALUE',new_data:{provider:'AlyawmGold',quoteRecordedAtUtc:live.quoteRecordedAtUtc,stale:{gold:live.goldStale,silver:live.silverStale,fx:live.fxStale},results}});
 return {provider:'AlyawmGold',...live,results};
}

export async function GET(req:Request){try{const {supabase,user}=await requireUser();const {searchParams}=new URL(req.url);if(searchParams.get('live')==='1'){const synced=await syncLive(supabase,user.id);return NextResponse.json(synced)}let q=supabase.from('market_prices').select('*').order('valuation_date',{ascending:false}).order('created_at',{ascending:false}).limit(200);if(searchParams.get('asset_type'))q=q.eq('asset_type',searchParams.get('asset_type')!);const {data,error}=await q;if(error)throw error;return NextResponse.json(data??[])}catch(e:any){return NextResponse.json({error:e.message},{status:400})}}
export async function POST(req:Request){try{const {supabase,user}=await requireUser();const p=priceSchema.parse(await req.json());const {data,error}=await supabase.from('market_prices').insert(p).select().single();if(error)throw error;const revaluation=await revalueMetalAssets(supabase,user.id,data);await supabase.from('audit_logs').insert({user_id:user.id,entity_type:'market_price',entity_id:data.id,action:'CREATE_AND_REVALUE',new_data:{price:data,revaluation}});return NextResponse.json({...data,revaluation},{status:201})}catch(e:any){return NextResponse.json({error:e.message},{status:400})}}
