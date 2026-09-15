import Decimal from 'decimal.js';
export type NisabStandard='GOLD'|'SILVER';
export function calculateNisab(standard:NisabStandard,goldPrice:Decimal.Value,silverPrice:Decimal.Value,currency:string){const quantity=new Decimal(standard==='GOLD'?85:595);const price=new Decimal(standard==='GOLD'?goldPrice:silverPrice);return {standard,quantity,pricePerUnit:price,valueBase:quantity.mul(price),currency};}
