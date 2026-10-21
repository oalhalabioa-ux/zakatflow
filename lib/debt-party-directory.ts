import {z} from 'zod';
export const personalPartySourceSchema=z.union([z.string().uuid(),z.string().regex(/^party:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)]);
export const partyScopeSchema=z.enum(['PERSONAL','ORGANIZATION']);
export const partyFieldsSchema=z.object({
 name:z.string().trim().min(1).max(120),party_type:z.enum(['CUSTOMER','SUPPLIER','BOTH','PERSON','OTHER']),
 contact_name:z.string().trim().max(120).default(''),phone:z.string().trim().max(40).default(''),
 email:z.union([z.literal(''),z.email().max(160)]).default(''),notes:z.string().trim().max(500).default(''),active:z.boolean().default(true),
});
export const partyMutationSchema=z.object({scope:partyScopeSchema,organization_id:z.string().uuid().nullable().default(null),id:z.string().uuid().optional(),party_key:z.string().max(240).optional(),action:z.enum(['SAVE','DELETE']),...partyFieldsSchema.partial().shape}).strict().superRefine((p,c)=>{
 if(p.scope==='ORGANIZATION'&&!p.organization_id||p.scope==='PERSONAL'&&p.organization_id)c.addIssue({code:'custom',message:'PARTY_SCOPE_INVALID'});
 if(p.action==='DELETE'&&!p.id)c.addIssue({code:'custom',message:'PARTY_ID_REQUIRED'});
 if(p.action==='SAVE'&&!partyFieldsSchema.safeParse(p).success)c.addIssue({code:'custom',message:'VALIDATION_FAILED'});
});
export type DebtParty={id:string|null;party_key:string;organization_id:string|null;name:string;party_type:string;party_type_id?:string|null;contact_name:string;phone:string;email:string;notes:string;active:boolean;legacy?:boolean;canWrite?:boolean;linked?:boolean};
export const partyError=(code:string)=>({PARTY_IN_USE:'لا يمكن حذف جهة لها سجلات مالية، حتى لو كان رصيدها صفرًا. يمكنك أرشفتها.',PARTY_ARCHIVED:'الجهة مؤرشفة؛ أعد تفعيلها قبل تسجيل حركة جديدة.',PARTY_ACCESS_DENIED:'لا تملك صلاحية إدارة هذه الجهة.',ORGANIZATION_ACCESS_REQUIRED:'لا تملك صلاحية الوصول إلى الشركة.',VALIDATION_FAILED:'راجع اسم الجهة والبريد الإلكتروني وبقية البيانات.',UNAUTHORIZED:'انتهت جلسة الدخول. أعد تسجيل الدخول.'}[code]??'تعذر حفظ التغيير. لم تُغيّر الأرصدة؛ حاول مجددًا.');
