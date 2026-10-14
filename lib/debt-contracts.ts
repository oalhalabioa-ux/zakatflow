import {z} from 'zod';
import Decimal from 'decimal.js';
import {debtCategorySchema} from './debt-categories';
const money=z.number().finite().positive().max(1e12).refine(n=>new Decimal(n).decimalPlaces()<=4);
export const debtContractSchema=z.object({organization_id:z.string().uuid(),request_id:z.string().uuid(),kind:z.enum(['OPENING','LOAN','EMPLOYEE_ADVANCE']),mode:z.enum(['OPENING','NEW']),side:z.enum(['RECEIVABLE','PAYABLE']),counterparty_id:z.string().uuid(),entity_id:z.string().uuid().nullable(),account_id:z.string().uuid().nullable(),category:debtCategorySchema,description:z.string().trim().min(3).max(500),reference:z.string().trim().min(1).max(120),date:z.string().date(),currency:z.string().regex(/^[A-Z]{3}$/),exchange_rate:z.number().finite().positive(),principal:money,schedule:z.array(z.object({amount:money,due_date:z.string().date()}).strict()).min(1).max(48)}).strict().superRefine((p,c)=>{
 if(!p.category.startsWith(p.side==='RECEIVABLE'?'O_AR_':'O_AP_'))c.addIssue({code:'custom',message:'CATEGORY_SIDE_MISMATCH'});
 if(p.kind==='OPENING'&&p.mode!=='OPENING'||p.mode==='NEW'&&!p.account_id||p.kind==='EMPLOYEE_ADVANCE'&&p.side!=='RECEIVABLE')c.addIssue({code:'custom',message:'CONTRACT_MODE_INVALID'});
 if(p.kind==='LOAN'&&p.category!==(p.side==='RECEIVABLE'?'O_AR_LOAN':'O_AP_LOAN')||p.kind==='EMPLOYEE_ADVANCE'&&p.category!=='O_AR_EMPLOYEE')c.addIssue({code:'custom',message:'CONTRACT_CATEGORY_INVALID'});
 if(!new Decimal(p.principal).eq(p.schedule.reduce((n,s)=>n.plus(s.amount),new Decimal(0))))c.addIssue({code:'custom',message:'SCHEDULE_TOTAL_MISMATCH'});
 if(p.schedule.some(s=>s.due_date<p.date))c.addIssue({code:'custom',message:'SCHEDULE_DATE_INVALID'});
});
export function installmentSchedule(principal:number,count:number,firstDate:string){if(!Number.isFinite(principal)||principal<=0||!Number.isInteger(count)||count<1||count>48)throw Error('INVALID_SCHEDULE');const value=new Decimal(principal).div(count).toDecimalPlaces(4,Decimal.ROUND_DOWN),[y,m,d]=firstDate.split('-').map(Number);return Array.from({length:count},(_,i)=>{const start=new Date(Date.UTC(y,m-1+i,1)),last=new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth()+1,0)).getUTCDate();start.setUTCDate(Math.min(d,last));return {due_date:start.toISOString().slice(0,10),amount:(i===count-1?new Decimal(principal).minus(value.mul(count-1)):value).toNumber()};});}
