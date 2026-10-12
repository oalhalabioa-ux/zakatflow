import Decimal from 'decimal.js';
export type DisplayCurrencyMode='PRIMARY'|'USD';
export type DisplayFxRate={from_currency:string;to_currency:string;rate:number;valuation_date:string;source:string;organization_id?:string|null};
export const SAR_USD_REFERENCE={from_currency:'USD',to_currency:'SAR',rate:3.75,valuation_date:'2026-10-12',source:'SAMA · official peg'} satisfies DisplayFxRate;
export function displayQuote(currency:string,rates:DisplayFxRate[],today:string){
 const code=currency.toUpperCase();
 if(code==='USD')return {rate:1,recordedRate:1,inverse:false,date:today,source:'USD'};
 const valid=rates.filter(r=>r.valuation_date<=today&&Number.isFinite(Number(r.rate))&&Number(r.rate)>0&&((r.from_currency===code&&r.to_currency==='USD')||(r.from_currency==='USD'&&r.to_currency===code))).sort((a,b)=>Number(!!b.organization_id)-Number(!!a.organization_id)||b.valuation_date.localeCompare(a.valuation_date));
 const row=valid[0]??(code==='SAR'?SAR_USD_REFERENCE:null);
 if(!row)return null;
 return {recordedRate:Number(row.rate),inverse:row.from_currency!==code,rate:row.from_currency===code?Number(row.rate):new Decimal(1).div(row.rate).toNumber(),date:row.valuation_date,source:row.source};
}
export function displayAmount(value:unknown,currency:string,mode:DisplayCurrencyMode,rates:DisplayFxRate[],today:string,primaryCurrency=currency){
 const n=value==null||value===''?NaN:Number(value),code=currency.toUpperCase(),target=mode==='USD'?'USD':primaryCurrency.toUpperCase();
 if(!Number.isFinite(n))return {value:null,currency:code,missing:false,quote:null};
 if(code===target)return {value:n,currency:code,missing:false,quote:null};
 const from=displayQuote(code,rates,today),to=displayQuote(target,rates,today);
 if(!from||!to)return {value:n,currency:code,missing:true,quote:null};
 const usd=from.inverse?new Decimal(n).div(from.recordedRate):new Decimal(n).mul(from.recordedRate);
 const converted=to.inverse?usd.mul(to.recordedRate):usd.div(to.recordedRate);
 const references=[from,to].filter(q=>q.source!=='USD');
 const quote={rate:from.rate/to.rate,date:references.map(q=>q.date).sort()[0]||today,source:[...new Set(references.map(q=>q.source))].join(' / ')};
 return {value:converted.toNumber(),currency:target,missing:false,quote};
}

export function scopedDisplayRates(rates:DisplayFxRate[],organizationId?:string|null){return rates.filter(r=>!r.organization_id||r.organization_id===organizationId);}
