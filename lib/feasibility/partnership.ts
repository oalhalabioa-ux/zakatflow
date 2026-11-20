import {z} from 'zod';
import type {FeasibilityStudy} from './engine';

const amount=z.number().finite().min(0).max(1e12);
const share=z.number().finite().min(0).max(100);
export const landArrangementSchema=z.discriminatedUnion('mode',[
 z.object({mode:z.literal('LEASE'),monthlyRent:amount}).strict(),
 z.object({mode:z.literal('IN_KIND'),valuation:amount}).strict(),
 z.object({mode:z.literal('PURCHASE'),price:amount,fees:amount}).strict()
]);
const installmentSchema=z.object({
 id:z.string().uuid(),type:z.enum(['EQUITY','LOAN']),
 amount,expectedOn:z.iso.date().optional(),revisedOn:z.iso.date().optional(),paid:amount,paidOn:z.iso.date().optional()
}).strict();
const partnerSchema=z.object({
 id:z.string().uuid(),name:z.string().max(300),
 ownershipPct:share,profitPct:share,cashCommitted:amount,capitalCommitted:amount.optional(),cashPaid:amount,loanPaid:amount,
 installments:z.array(installmentSchema).max(100).optional()
}).strict();
export const partnershipSchema=z.object({
 partners:z.array(partnerSchema).max(50),landPartnerId:z.string().uuid().optional(),asOf:z.iso.date().optional()
}).strict().refine(value=>{
 const ids=new Set(value.partners.map(partner=>partner.id));
 return value.partners.every(p=>new Set(p.installments?.map(x=>x.id)).size===(p.installments?.length??0))&&
  ids.size===value.partners.length&&(!value.landPartnerId||ids.has(value.landPartnerId));
});
export type LandArrangement=z.infer<typeof landArrangementSchema>;
export type Partnership=z.infer<typeof partnershipSchema>;
export type Partner=Partnership['partners'][number];
export type Installment=z.infer<typeof installmentSchema>;

export function partnerPaidAmounts(partner:Partner,asOf?:string){
 const installments=partner.installments;
 if(!installments?.length)return {cashPaid:partner.cashPaid,loanPaid:partner.loanPaid};
 const paid=(type:Installment['type'])=>installments.reduce((total,row)=>
  total+(row.type===type&&row.paidOn&&(!asOf||row.paidOn<=asOf)?row.paid:0),0);
 return {cashPaid:paid('EQUITY'),loanPaid:paid('LOAN')};
}

export function allocatePartnerInstallments(partnership:Partnership|undefined,startMonth:string|undefined){
 if(!partnership?.asOf||!startMonth)return null;
 const {asOf}=partnership;
 const rows=Array.from({length:12},()=>({equity:0,loan:0}));
 const ordinal=(date:string)=>Number(date.slice(0,4))*12+Number(date.slice(5,7));
 const start=ordinal(startMonth);
 let overdue=0,undated=0,futureActual=0,beforeWindow=0,afterWindow=0,scheduledLoan=0;
 const undatedLegacy=partnership.partners.reduce((total,partner)=>total+
  (partner.installments?.length?0:partner.cashPaid+partner.loanPaid),0);
 const add=(type:Installment['type'],amount:number,date:string)=>{
  const index=ordinal(date)-start;
  if(index<0)beforeWindow+=amount;
  else if(index>=rows.length)afterWindow+=amount;
  else rows[index][type==='EQUITY'?'equity':'loan']+=amount;
 };
 for(const partner of partnership.partners)for(const item of partner.installments??[]){
  if(item.type==='LOAN')scheduledLoan+=Math.max(item.amount,item.paid);
  if(item.paid>0){
   if(!item.paidOn)undated+=item.paid;
   else if(item.paidOn>asOf)futureActual+=item.paid;
   else add(item.type,item.paid,item.paidOn);
  }
  const remaining=Math.max(0,item.amount-item.paid);
  if(remaining===0)continue;
  const expectedOn=item.revisedOn??item.expectedOn;
  if(!expectedOn)undated+=remaining;
  else if(expectedOn<asOf)overdue+=remaining;
  else add(item.type,remaining,expectedOn);
 }
 return {rows,overdue,undated,futureActual,beforeWindow,afterWindow,scheduledLoan,undatedLegacy};
}

export function generalLandCosts(study:Pick<FeasibilityStudy,'landArrangement'|'landTransferred'|'landValue'>){
 const arrangement=study.landArrangement;
 return {
  inKind:arrangement?arrangement.mode==='IN_KIND'?arrangement.valuation:0:study.landTransferred?study.landValue:0,
  purchase:arrangement?.mode==='PURCHASE'?arrangement.price+arrangement.fees:0,
  rent:arrangement?.mode==='LEASE'?arrangement.monthlyRent:0
 };
}

export function summarizePartnership(partnership:Partnership,inKindLand=0){
 const rows=partnership.partners.map(partner=>{
  const {cashPaid,loanPaid}=partnerPaidAmounts(partner,partnership.asOf);
  const inKindPaid=partner.id===partnership.landPartnerId?inKindLand:0;
  // Legacy drafts stored the cash portion of the commitment.
  const committed=partner.capitalCommitted??(partner.cashCommitted+inKindPaid);
  const cashRequired=Math.max(0,committed-inKindPaid);
  return {partner,committed,cashRequired,cashPaid,loanPaid,inKindPaid,
   outstanding:Math.max(0,cashRequired-cashPaid),overpaid:cashPaid+inKindPaid>committed+0.000001};
 });
 const totals=rows.reduce((sum,row)=>({
  ownershipPct:sum.ownershipPct+row.partner.ownershipPct,profitPct:sum.profitPct+row.partner.profitPct,
  committed:sum.committed+row.committed,cashRequired:sum.cashRequired+row.cashRequired,
  cashPaid:sum.cashPaid+row.cashPaid,loanPaid:sum.loanPaid+row.loanPaid,inKindPaid:sum.inKindPaid+row.inKindPaid,
  outstanding:sum.outstanding+row.outstanding
 }),{ownershipPct:0,profitPct:0,committed:0,cashRequired:0,cashPaid:0,loanPaid:0,inKindPaid:0,outstanding:0});
 return {...totals,rows,ownershipBalanced:Math.abs(totals.ownershipPct-100)<1e-8,
  profitBalanced:Math.abs(totals.profitPct-100)<1e-8};
}
