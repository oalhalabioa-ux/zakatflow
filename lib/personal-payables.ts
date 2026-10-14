import {debtCategorySchema} from './debt-categories';
import {z} from 'zod';
const uuid=z.string().uuid(),money=z.number().finite().positive().max(1e12).refine(n=>Math.abs(n*10000-Math.round(n*10000))<0.00001);
export const personalPayableCommandSchema=z.discriminatedUnion('action',[
 z.object({action:z.literal('CREATE'),category:debtCategorySchema.refine(c=>c.startsWith('P_AP_')).optional(),request_id:uuid,party:z.string().trim().min(1).max(120),description:z.string().trim().min(3).max(500),amount:money,date:z.string().date(),due_date:z.string().date().nullable(),reference:z.string().trim().max(120)}).strict(),
 z.object({action:z.literal('PAY'),request_id:uuid,payable_id:uuid,account_id:uuid,amount:money,date:z.string().date(),notes:z.string().trim().min(3).max(500)}).strict(),
 z.object({action:z.literal('REVERSE_PAYMENT'),payable_id:uuid,payment_id:uuid,reason:z.string().trim().min(3).max(500)}).strict(),
 z.object({action:z.literal('CANCEL'),payable_id:uuid,reason:z.string().trim().min(3).max(500)}).strict()
]);

export function personalPayableRecords(debts:any[],payments:any[],transactions:any[]){
 const active=debts.filter(d=>!d.cancelled_at),rows:any[]=[],movements:any[]=[],history:any[]=[];
 for(const d of active){const key='personal-payable:'+d.party.trim().toLocaleLowerCase();let paid=0;const base={debtId:d.id,organizationId:'PERSONAL',partyKey:key,partyName:d.party,side:'PURCHASE' as const,due:d.due_date,reference:d.reference||d.id,currency:d.currency,advance:false};
 movements.push({...base,id:d.id,createdAt:d.created_at,date:d.event_date,description:d.description,amount:Number(d.amount),kind:'INVOICE'});
 for(const p of payments.filter(p=>p.payable_id===d.id)){const rev=transactions.find(t=>t.reversal_of_transaction_id===p.transaction_id);if(!rev)paid+=Number(p.amount);movements.push({...base,id:p.id,createdAt:p.created_at,date:p.payment_date,description:p.notes,amount:-Number(p.amount),kind:'PAYMENT'});if(rev)movements.push({...base,id:rev.id,createdAt:rev.created_at,date:rev.transaction_date,description:'عكس سداد · '+p.notes,amount:Number(p.amount),kind:'REVERSAL'});history.push({...p,reversed:Boolean(rev),reversalDate:rev?.transaction_date});}
 rows.push({id:d.id,partyKey:key,partyName:d.party,organizationId:null,entityId:null,side:'PAYABLE',currency:d.currency,amount:Math.round((Number(d.amount)-paid)*10000)/10000,dueDate:d.due_date,date:d.event_date,description:d.description,source:'PERSONAL_PAYABLE',eventId:null,reference:d.reference||d.id,originalCurrency:d.currency,originalAmount:Number(d.amount),exchangeRate:1,totalBase:Number(d.amount),appliedBase:paid});
 }
 movements.sort((a,b)=>a.date.localeCompare(b.date)||(a.createdAt??'').localeCompare(b.createdAt??'')||({INVOICE:0,PAYMENT:1,REVERSAL:2}[a.kind as 'INVOICE']??1)-({INVOICE:0,PAYMENT:1,REVERSAL:2}[b.kind as 'INVOICE']??1)||a.id.localeCompare(b.id));
 return {debts:rows,movements,history};
}
