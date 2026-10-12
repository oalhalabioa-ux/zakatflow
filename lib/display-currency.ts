import Decimal from 'decimal.js';
export type DisplayCurrencyMode='PRIMARY'|'USD';
export type DisplayFxRate={from_currency:string;to_currency:string;rate:number;valuation_date:string;source:string};
export const SAR_USD_REFERENCE={from_currency:'USD',to_currency:'SAR',rate:3.75,valuation_date:'2026-10-12',source:'SAMA · official peg'} satisfies DisplayFxRate;
export function displayQuote(currency:string,rates:DisplayFxRate[],today:string){
 const code=currency.toUpperCase();
 if(code==='USD')return {rate:1,recordedRate:1,inverse:false,date:today,source:'USD'};
 const valid=rates.filter(r=>r.valuation_date<=today&&Number.isFinite(Number(r.rate))&&Number(r.rate)>0&&((r.from_currency===code&&r.to_currency==='USD')||(r.from_currency==='USD'&&r.to_currency===code))).sort((a,b)=>b.valuation_date.localeCompare(a.valuation_date));
 const row=valid[0]??(code==='SAR'?SAR_USD_REFERENCE:null);
 if(!row)return null;
 return {recordedRate:Number(row.rate),inverse:row.from_currency!==code,rate:row.from_currency===code?Number(row.rate):new Decimal(1).div(row.rate).toNumber(),date:row.valuation_date,source:row.source};
}
export function displayAmount(value:unknown,currency:string,mode:DisplayCurrencyMode,rates:DisplayFxRate[],today:string){
 const n=Number(value),code=currency.toUpperCase();
 if(!Number.isFinite(n))return {value:null,currency:code,missing:false,quote:null};
 if(mode==='PRIMARY'||code==='USD')return {value:n,currency:code,missing:false,quote:null};
 const quote=displayQuote(code,rates,today);
 if(!quote)return {value:n,currency:code,missing:true,quote:null};
 return {value:(quote.inverse?new Decimal(n).div(quote.recordedRate):new Decimal(n).mul(quote.recordedRate)).toNumber(),currency:'USD',missing:false,quote};
}
