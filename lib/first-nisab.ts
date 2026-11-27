import Decimal from 'decimal.js';

export type Standard = 'GOLD' | 'SILVER';
export type Movement = {id:string;date:string;asset:'GOLD'|'SILVER'|'CASH';units:string};
export type Quote = {id:string;date:string;asset:Standard;price:string;source:string};

// Daily closing balances. A missing earlier valuation prevents proof of a first crossing.
export function firstNisab(movements:Movement[], quotes:Quote[], standard:Standard, through:string) {
 const ordered = [...movements].sort((a,b)=>a.date.localeCompare(b.date));
 const prices = new Map<string,Quote>();
 const conflicts = new Set<string>();
 for (const quote of quotes) {
   const key=quote.date+quote.asset, old=prices.get(key);
   if (old && !new Decimal(old.price).eq(quote.price)) conflicts.add(key);
   prices.set(key,quote);
 }
 const balance={GOLD:new Decimal(0),SILVER:new Decimal(0),CASH:new Decimal(0)};
 const history:string[]=[];
 let i=0;
 for(let day=ordered[0]?.date; day && day<=through;) {
   while(i<ordered.length && ordered[i].date===day) {
     const movement=ordered[i++];
     balance[movement.asset]=balance[movement.asset].plus(movement.units);
     history.push(movement.id);
   }
   if(Object.values(balance).some(x=>x.isNegative())) return {status:'REVIEW',day,reason:'NEGATIVE_BALANCE'} as const;
   const other=standard==='GOLD'?'SILVER':'GOLD';
   const grams=standard==='GOLD'?85:595;
   // A single metal below its gram threshold cannot cross because of its own price.
   if(balance.CASH.gt(0)||balance[other].gt(0)||balance[standard].gte(grams)) {
     let total=balance.CASH;
     const sources:Quote[]=[];
     for(const metal of ['GOLD','SILVER'] as const) {
       if(metal!==standard && balance[metal].isZero()) continue;
       const key=day+metal, quote=prices.get(key);
       if(!quote || conflicts.has(key) || !new Decimal(quote.price).gt(0))
         return {status:'REVIEW',day,reason:'DATED_PRICE_REQUIRED'} as const;
       sources.push(quote);
       total=total.plus(balance[metal].times(quote.price));
     }
     const threshold=new Decimal(prices.get(day+standard)!.price).times(grams);
     if(total.gte(threshold)) return {status:'PROVEN',day,value:total.toString(),threshold:threshold.toString(),
       sources,movementIds:history,standard,basis:'DAILY_CLOSE'} as const;
   }
   day=new Date(Date.parse(day+'T00:00:00Z')+86400000).toISOString().slice(0,10);
 }
 return {status:'BELOW'} as const;
}
