import {z} from 'zod';
import Decimal from 'decimal.js';
import {financingSchedule,type FinancingTerms} from './financing-schedule';
const amount=z.number().finite().positive().max(1e12).refine(v=>new Decimal(v).decimalPlaces()<=4);
const uuid=z.string().uuid();
export const personalContractTermsSchema=z.object({
 product:z.enum(['QARD','FINANCING','PARTICIPATION']),side:z.enum(['RECEIVABLE','PAYABLE']),mode:z.enum(['NEW','OPENING','LINKED']),
 party:z.string().trim().min(1).max(120),reference:z.string().trim().min(1).max(120),description:z.string().trim().min(3).max(500),
 principal:amount,date:z.string().date(),currency:z.string().regex(/^[A-Z]{3}$/),account_id:uuid.nullable(),source_id:uuid.nullable(),
 schedule:z.array(z.object({amount,due_date:z.string().date()}).strict()).min(1).max(48),
 finance:z.object({annualRate:z.number().finite().positive().max(100),method:z.enum(['DECLINING','FLAT']),repayment:z.enum(['EQUAL_PRINCIPAL','EQUAL_PAYMENT']),frequencyMonths:z.union([z.literal(1),z.literal(3),z.literal(6),z.literal(12)]),yearDays:z.union([z.literal(354),z.literal(360),z.literal(365)])}).strict().nullable(),
 profit_share:z.number().finite().min(0).max(100),zakatable:z.boolean()
}).strict().superRefine((p,c)=>{
 if(p.mode==='NEW'&&!p.account_id)c.addIssue({code:'custom',path:['account_id'],message:'ACCOUNT_REQUIRED'});
 if(p.mode==='LINKED'&&!p.source_id||p.mode!=='LINKED'&&p.source_id)c.addIssue({code:'custom',path:['source_id'],message:'SOURCE_REQUIRED'});
 if(p.mode==='LINKED'&&p.product==='PARTICIPATION')c.addIssue({code:'custom',message:'LINK_DEBT_ONLY'});
 if(p.schedule.some(r=>r.due_date<p.date)||p.schedule.some((r,i)=>i>0&&r.due_date<p.schedule[i-1].due_date))c.addIssue({code:'custom',path:['schedule'],message:'SCHEDULE_DATES_INVALID'});
 if(!p.schedule.reduce((s,r)=>s.plus(r.amount),new Decimal(0)).eq(p.principal))c.addIssue({code:'custom',path:['schedule'],message:'SCHEDULE_TOTAL_INVALID'});
 if(p.product==='FINANCING'){
  if(!p.finance)c.addIssue({code:'custom',path:['finance'],message:'FINANCE_TERMS_REQUIRED'});
  else try{const plan=personalContractPlan(p);if(plan.some((r,i)=>r.principal!==p.schedule[i].amount||r.due_date!==p.schedule[i].due_date))throw Error();}catch{c.addIssue({code:'custom',path:['finance'],message:'FINANCE_PLAN_MISMATCH'});}
 }else if(p.finance)c.addIssue({code:'custom',path:['finance'],message:'FINANCE_TERMS_NOT_ALLOWED'});
});
export type PersonalContractTerms=z.infer<typeof personalContractTermsSchema>;
export function personalContractPlan(p:Pick<PersonalContractTerms,'finance'|'principal'|'date'|'schedule'>){if(!p.finance)return [];return financingSchedule({...p.finance,principal:p.principal,startDate:p.date,firstDueDate:p.schedule[0].due_date,count:p.schedule.length} as FinancingTerms);}
export const personalContractCommandSchema=z.discriminatedUnion('action',[
 z.object({action:z.literal('SAVE'),request_id:uuid,id:uuid.optional(),expected_revision:z.number().int().nonnegative().optional(),payload:personalContractTermsSchema}).strict(),
 z.object({action:z.enum(['EXECUTE','CANCEL']),id:uuid,expected_revision:z.number().int().nonnegative(),reason:z.string().trim().min(3).max(500)}).strict(),
 z.object({action:z.enum(['SETTLE','CHARGE','PROFIT','LOSS','SETTLE_CHARGE','REVERSE']),id:uuid,request_id:uuid,date:z.string().date(),amount:amount.optional(),account_id:uuid.optional(),number:z.number().int().min(1).max(48).optional(),movement_id:uuid.optional(),reason:z.string().trim().min(3).max(500)}).strict()
]);
export type PersonalContract={id:string;product:PersonalContractTerms['product'];side:PersonalContractTerms['side'];status:'DRAFT'|'POSTED'|'CANCELLED';revision:number;terms:PersonalContractTerms;asset_id:string|null;payable_id:string|null;principal:number;currency:string;created_at:string};
export type PersonalContractMovement={id:string;contract_id:string;kind:string;amount:number;operation_date:string;reversed_at:string|null;reversal_date?:string|null;asset_id:string|null;payable_id:string|null;installment_number:number|null;transaction_ids:string[];created_at:string;notes:string};
export function personalInstallmentBalances(schedule:Array<{amount:number;due_date:string}>,principal:number,outstanding:number){let applied=Decimal.max(0,new Decimal(principal).minus(outstanding));return schedule.map((r,i)=>{const paid=Decimal.min(applied,r.amount);applied=applied.minus(paid);return {number:i+1,amount:r.amount,due_date:r.due_date,paid:paid.toNumber(),remaining:new Decimal(r.amount).minus(paid).toNumber()};});}
export const personalProductNames={QARD:'القروض الحسنة',FINANCING:'التمويل بعائد',PARTICIPATION:'عقود الاستثمار والمشاركة'};
