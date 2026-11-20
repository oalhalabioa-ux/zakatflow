import {z} from 'zod';
import type {FeasibilityStudy} from './engine';

const amount=z.number().finite().min(0).max(1e12);
const share=z.number().finite().min(0).max(100);
export const landArrangementSchema=z.discriminatedUnion('mode',[
 z.object({mode:z.literal('LEASE'),monthlyRent:amount}).strict(),
 z.object({mode:z.literal('IN_KIND'),valuation:amount}).strict(),
 z.object({mode:z.literal('PURCHASE'),price:amount,fees:amount}).strict()
]);
const partnerSchema=z.object({
 id:z.string().uuid(),name:z.string().max(300),
 ownershipPct:share,profitPct:share,cashCommitted:amount,cashPaid:amount,loanPaid:amount
}).strict();
export const partnershipSchema=z.object({
 partners:z.array(partnerSchema).max(50),landPartnerId:z.string().uuid().optional(),asOf:z.iso.date().optional()
}).strict().refine(value=>{
 const ids=new Set(value.partners.map(partner=>partner.id));
 return ids.size===value.partners.length&&(!value.landPartnerId||ids.has(value.landPartnerId));
});
export type LandArrangement=z.infer<typeof landArrangementSchema>;
export type Partnership=z.infer<typeof partnershipSchema>;
export type Partner=Partnership['partners'][number];

export function generalLandCosts(study:Pick<FeasibilityStudy,'landArrangement'|'landTransferred'|'landValue'>){
 const arrangement=study.landArrangement;
 return {
  inKind:arrangement?arrangement.mode==='IN_KIND'?arrangement.valuation:0:study.landTransferred?study.landValue:0,
  purchase:arrangement?.mode==='PURCHASE'?arrangement.price+arrangement.fees:0,
  rent:arrangement?.mode==='LEASE'?arrangement.monthlyRent:0
 };
}

export function summarizePartnership(partnership:Partnership){
 const totals=partnership.partners.reduce((sum,person)=>({
  ownershipPct:sum.ownershipPct+person.ownershipPct,profitPct:sum.profitPct+person.profitPct,
  committed:sum.committed+person.cashCommitted,cashPaid:sum.cashPaid+person.cashPaid,loanPaid:sum.loanPaid+person.loanPaid,
  outstanding:sum.outstanding+Math.max(0,person.cashCommitted-person.cashPaid)
 }),{ownershipPct:0,profitPct:0,committed:0,cashPaid:0,loanPaid:0,outstanding:0});
 return {...totals,ownershipBalanced:Math.abs(totals.ownershipPct-100)<1e-8,
  profitBalanced:Math.abs(totals.profitPct-100)<1e-8};
}
