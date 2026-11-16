import {debtCategorySchema} from './debt-categories';
import {personalPartySourceSchema} from './debt-party-directory';
import {z} from 'zod';
import Decimal from 'decimal.js';
const uuid=z.string().uuid();
export const personalFinancingSchema=z.discriminatedUnion('action',[
 z.object({action:z.literal('FUND'),request_id:uuid,kind:z.enum(['LOAN','ADVANCE']),side:z.enum(['RECEIVABLE','PAYABLE']),category:debtCategorySchema.optional(),source_debt_id:personalPartySourceSchema.optional(),party:z.string().trim().min(1).max(120),description:z.string().trim().min(3).max(500),reference:z.string().trim().min(1).max(120),amount:z.number().finite().positive().max(1e12).refine(n=>new Decimal(n).decimalPlaces()<=4),date:z.string().date(),due_date:z.string().date().nullable(),account_id:uuid}).strict(),
 z.object({action:z.literal('REVERSE'),id:uuid,reason:z.string().trim().min(5).max(500)}).strict()
] ).superRefine((v,ctx)=>{if(v.action==='FUND'&&v.category&&!v.category.startsWith(v.side==='PAYABLE'?'P_AP_':'P_AR_'))ctx.addIssue({code:'custom',path:['category'],message:'DEBT_CATEGORY_SIDE_MISMATCH'});});
