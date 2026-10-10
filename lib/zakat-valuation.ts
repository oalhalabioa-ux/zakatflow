import Decimal from 'decimal.js';
import {z} from 'zod';

export const assessmentRequestSchema=z.object({
 assessment_date:z.string().date(),valuation_date:z.string().date().optional(),
 nisab_standard:z.enum(['GOLD','SILVER']).optional(),method_id:z.string().uuid().optional(),
 gold_price:z.number().finite().nonnegative().optional(),silver_price:z.number().finite().nonnegative().optional(),
 price_currency:z.string().regex(/^[A-Z]{3}$/).optional(),fx_rate:z.number().finite().positive().optional(),
 price_mode:z.enum(['REFERENCE','MANUAL']).optional(),price_source:z.string().trim().max(120).optional(),
 nisab_reached_date:z.string().date().optional(),nisab_start_method:z.enum(['MANUAL','HISTORICAL_RECORDED']).optional(),
});

export type FrozenMetalPrice={price:number;currency:string;fxRate:number;source:string;priceId?:string|null};
export function requireMetalPrice(price:FrozenMetalPrice|undefined, metal:string):FrozenMetalPrice {
 if(!price || !Number.isFinite(price.price) || price.price<=0)throw new Error(`${metal}_VALUATION_PRICE_REQUIRED`);
 if(!Number.isFinite(price.fxRate)||price.fxRate<=0)throw new Error('VALUATION_FX_RATE_REQUIRED');
 return price;
}
export function nisabFromPrice(standard:'GOLD'|'SILVER',prices:Record<string,FrozenMetalPrice>){
 const p=requireMetalPrice(prices[standard],standard);
 return new Decimal(standard==='GOLD'?85:595).mul(p.price).mul(p.fxRate);
}
export function frozenLotValuation(lot:any,assetLots:any[],baseCurrency:string,prices:Record<string,FrozenMetalPrice>){
 const a=Array.isArray(lot.asset_accounts)?lot.asset_accounts[0]:lot.asset_accounts;
 const m=a.metadata??{},quantity=new Decimal(lot.remaining_quantity??0);
 let price=new Decimal(0),purity=new Decimal(1),currency=baseCurrency,fxRate=1,source='LOT_COST_BASE',priceId:string|null=null;
 let value=new Decimal(lot.remaining_value_base??0);
 if(['GOLD','SILVER'].includes(a.asset_type)){
  const p=requireMetalPrice(prices[a.asset_type],a.asset_type);price=new Decimal(p.price);currency=p.currency;fxRate=p.fxRate;source=p.source;priceId=p.priceId??null;
  const raw=Number(a.asset_type==='GOLD'?(m.karat??24):(m.purity??m.karat??999));
  const factor=a.asset_type==='GOLD'?raw/24:(raw>1?raw/1000:raw);
  if(!Number.isFinite(factor)||factor<=0||factor>1)throw new Error('ASSET_PURITY_INVALID');
  purity=new Decimal(factor);value=quantity.mul(price).mul(purity).mul(fxRate);
 }else if(!['CASH','BANK'].includes(a.asset_type) && (m.market_price_per_unit!=null||m.market_price!=null||m.market_value!=null||m.estimated_value!=null)){
  currency=m.market_price_currency??a.currency;
  fxRate=currency===baseCurrency?1:Number(m.market_fx_rate??m.fx_rate??0);
  if(!Number.isFinite(fxRate)||fxRate<=0)throw new Error('ASSET_VALUATION_FX_RATE_REQUIRED');
  const unit=m.market_price_per_unit??m.market_price;
  if(unit!=null)price=new Decimal(unit);
  else {
   // Account-level values must be spread over all original lots only once.
   const original=assetLots.filter(l=>l.asset_account_id===lot.asset_account_id).reduce((s,l)=>s.add(l.original_quantity??0),new Decimal(0));
   if(original.lte(0))throw new Error('ASSET_VALUATION_QUANTITY_REQUIRED');
   price=new Decimal(m.market_value??m.estimated_value).div(original);
  }
  value=quantity.mul(price).mul(fxRate);source=m.market_price_source??'ASSET_MARKET_VALUE';
 }else if(quantity.gt(0))price=value.div(quantity);
 if(!value.isFinite()||value.lt(0))throw new Error('ASSET_VALUATION_INVALID');
 return {marketValueBase:value,valuationPrice:price.toString(),valuationCurrency:currency,fxRate,
  purity:purity.toString(),valuationSource:source,
  valuationSnapshot:{assetId:a.id??lot.asset_account_id,assetName:a.name,assetType:a.asset_type,
   quantity:quantity.toString(),purity:purity.toString(),unitPrice:price.toString(),priceCurrency:currency,
   fxRate,priceSource:source,priceId,marketValueBase:value.toString(),hawlStartDate:lot.hawl_start_date}};
}
