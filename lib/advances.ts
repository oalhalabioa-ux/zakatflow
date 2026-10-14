import {z} from 'zod';
import Decimal from 'decimal.js';
const uuid=z.string().uuid(),amount=z.number().finite().positive().refine(n=>new Decimal(n).decimalPlaces()<=4);
export const advanceCommandSchema=z.discriminatedUnion('action',[
 z.object({action:z.literal('RECORD'),request_id:uuid,side:z.enum(['SUPPLIER_ADVANCE','CUSTOMER_ADVANCE']),counterparty_id:uuid,account_id:uuid,entity_id:uuid.nullable(),amount,exchange_rate:z.number().finite().positive(),date:z.string().date(),reference:z.string().trim().min(1).max(120),description:z.string().trim().min(3).max(500)}).strict(),
 z.object({action:z.literal('APPLY'),request_id:uuid,advance_id:uuid,obligation_id:uuid,flow_id:uuid,amount,date:z.string().date(),description:z.string().trim().min(3).max(500)}).strict(),
 z.object({action:z.enum(['SUBMIT','APPROVE','POST','CANCEL']),event_id:uuid,reason:z.string().trim().min(3).max(500)}).strict()
]);
export function advanceAmounts(amount:number,rate:number){if(!Number.isFinite(amount)||!Number.isFinite(rate)||amount<=0||rate<=0)throw Error('ADVANCE_AMOUNT_INVALID');const base=new Decimal(amount).mul(rate).toDecimalPlaces(4).toNumber();if(base<=0)throw Error('ADVANCE_AMOUNT_INVALID');return {amount,base};}
export function compatibleAdvance(a:any,o:any){return a.organization_id===o.organization_id&&a.currency===o.currency&&a.base_currency===o.base_currency&&Number(a.exchange_rate)===Number(o.exchange_rate)&&((a.obligation_type==='SUPPLIER_ADVANCE'&&o.obligation_type==='PAYABLE')||(a.obligation_type==='CUSTOMER_ADVANCE'&&o.obligation_type==='RECEIVABLE'));}
export type AdvanceWorkspace={baseCurrency:string;parties:any[];accounts:any[];entities:any[];advances:any[];obligations:any[];flows:any[];requests:any[];canCreate:boolean};
