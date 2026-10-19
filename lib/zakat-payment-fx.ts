import Decimal from 'decimal.js';
export type ZakatFxRate={id:string;organization_id:string|null;organization_name?:string;from_currency:string;to_currency:string;rate:number;valuation_date:string;source:string};
/** Posting quotes require a saved rate. No display-only peg or guessed fallback. */
export function zakatPaymentFx(amount:number,currency:string,baseCurrency:string,rates:ZakatFxRate[],rateId:string|null,date:string){
 if(currency===baseCurrency)return {rate:1,baseAmount:Number.isFinite(amount)?new Decimal(amount).toDecimalPlaces(2).toNumber():0,row:null};
 if(currency!=='USD')return null;
 const row=rates.find(r=>r.id===rateId&&r.valuation_date<=date&&r.rate>0&&((r.from_currency===currency&&r.to_currency===baseCurrency)||(r.to_currency===currency&&r.from_currency===baseCurrency)));
 if(!row)return null;
 const rate=row.from_currency===currency?new Decimal(row.rate):new Decimal(1).div(row.rate);
 return {rate:rate.toDecimalPlaces(12).toNumber(),baseAmount:Number.isFinite(amount)?new Decimal(amount).mul(rate.toDecimalPlaces(12)).toDecimalPlaces(2).toNumber():0,row};
}
