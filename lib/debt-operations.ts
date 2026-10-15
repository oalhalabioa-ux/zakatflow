import {z} from 'zod';
const uuid=z.string().uuid(),reason=z.string().trim().min(5).max(500),money=z.number().finite().positive().max(1e12);
const common={request_id:uuid,organization_id:uuid,target_id:uuid,date:z.string().date(),reason};
export const debtOperationPrepareSchema=z.discriminatedUnion('kind',[
 z.object({...common,kind:z.literal('RESCHEDULE'),dates:z.array(z.object({obligation_id:uuid,due_date:z.string().date()}).strict()).min(1).max(48).refine(rows=>new Set(rows.map(r=>r.obligation_id)).size===rows.length,'DUPLICATE_INSTALLMENT')}).strict(),
 z.object({...common,kind:z.literal('REFUND'),account_id:uuid,amount:money}).strict(),
 z.object({...common,kind:z.literal('REVERSE')}).strict()
]);
export const debtOperationCommandSchema=z.discriminatedUnion('action',[
 z.object({action:z.literal('PREPARE'),payload:debtOperationPrepareSchema}).strict(),
 z.object({action:z.enum(['APPROVE','POST','CANCEL']),organization_id:uuid,id:uuid,reason}).strict()
]);
export const debtOperationLabels:Record<string,string>={RESCHEDULE:'إعادة جدولة الاستحقاقات',REFUND:'استرداد دفعة مقدمة',REVERSE:'عكس عملية',COMMITTED:'بانتظار الاعتماد والتنفيذ',ACTUAL:'منفذ',REVERSED:'معكوس',CANCELLED:'ملغى'};
