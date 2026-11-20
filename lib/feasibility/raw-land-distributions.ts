import {z} from 'zod';

const amount=z.number().min(0).max(1e12);
export const landDistributionSchema=z.object({
 partners:z.array(z.object({
  name:z.string().max(300),
  cash:amount,
  inKindLand:amount,
  priority:z.number().int().min(1).max(50),
  profitShare:z.number().min(0).max(1)
 }).strict()).max(50)
}).strict();

export type LandDistribution=z.infer<typeof landDistributionSchema>;
const total=(values:readonly number[])=>values.reduce((sum,value)=>sum+value,0);
const cashTolerance=0.005;

export function calculateLandDistribution(
 assumptions:LandDistribution,
 inKindLandValue:number,
 annual:readonly {year:number;equityCash:number;closingDebt:number}[],
 initialEquityCash=0
){
 const {partners}=assumptions;
 if(!annual.length||!partners.length||partners.some(partner=>!partner.name.trim()))return {issue:'PARTNERS'} as const;
 if(Math.abs(total(partners.map(partner=>partner.profitShare))-1)>1e-8)return {issue:'SHARES'} as const;
 if(Math.abs(total(partners.map(partner=>partner.inKindLand))-inKindLandValue)>=cashTolerance)return {issue:'LAND'} as const;

 const initialCash=total(partners.map(partner=>partner.cash));
 let cash=initialCash+initialEquityCash;
 let fundingGap=Math.max(0,-cash);
 for(const year of annual){
  cash+=year.equityCash;
  fundingGap=Math.max(fundingGap,-cash);
 }
 if(fundingGap>=cashTolerance)return {issue:'FUNDING',fundingGap} as const;

 const closing=annual[annual.length-1];
 const debtReserve=closing.closingDebt;
 const distributable=Math.max(0,cash-debtReserve);
 let remaining=distributable;
 const capital=partners.map(partner=>partner.cash+partner.inKindLand);
 const capitalReturned=partners.map(()=>0);
 for(const priority of Array.from(new Set(partners.map(partner=>partner.priority))).sort((a,b)=>a-b)){
  if(remaining<=0)break;
  const tierCapital=total(capital.map((value,i)=>partners[i].priority===priority?value:0));
  if(tierCapital===0)continue;
  const tierReturn=Math.min(tierCapital,remaining);
  partners.forEach((partner,i)=>{
   if(partner.priority===priority)capitalReturned[i]=tierReturn*(capital[i]/tierCapital);
  });
  remaining-=tierReturn;
 }
 const profitShares=total(partners.map(partner=>partner.profitShare));
 return {issue:null,year:closing.year,initialCash,debtReserve,
  debtShortfall:Math.max(0,debtReserve-Math.max(0,cash)),distributable,
  partners:partners.map((partner,i)=>{
   const profit=remaining*(partner.profitShare/profitShares);
   const distribution=capitalReturned[i]+profit;
   const capitalMultiple=capital[i]>0?distribution/capital[i]:null;
   return {...partner,capital:capital[i],capitalReturned:capitalReturned[i],
    unrecoveredCapital:Math.max(0,capital[i]-capitalReturned[i]),profit,distribution,
    netReturn:distribution-capital[i],capitalMultiple,
    annualizedReturn:capitalMultiple===null?null:capitalMultiple**(1/annual.length)-1};
  })
 } as const;
}
