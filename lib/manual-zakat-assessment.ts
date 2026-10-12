import Decimal from 'decimal.js';
import {z} from 'zod';
export type ManualZakatModel='PERSONAL'|'SIMPLE'|'SAUDI';
type Field={key:string;ar:string;en:string;hintAr:string;hintEn:string;deduction?:boolean;signed?:boolean};
export const manualZakatFields:Record<ManualZakatModel,Field[]>={
 PERSONAL:[
 {key:'cash',ar:'النقد والبنوك',en:'Cash and banks',hintAr:'الرصيد في تاريخ التقييم',hintEn:'Balance at the valuation date'},
 {key:'gold',ar:'الذهب والفضة الخاضعان',en:'Zakatable gold and silver',hintAr:'القيمة بعد تحديد العيار والغرض؛ استبعد غير الخاضع',hintEn:'Value after purity and purpose assessment; exclude exempt holdings'},
 {key:'inventory',ar:'المخزون وعروض التجارة',en:'Trading inventory',hintAr:'القيمة الزكوية للأموال المعدة للبيع',hintEn:'Zakat value of goods held for sale'},
 {key:'property',ar:'الأراضي والعقارات المعدة للبيع',en:'Property held for trading',hintAr:'لا يشمل السكن أو الأصول المستخدمة أو العقارات المؤجرة',hintEn:'Exclude homes, operating property and rental property principal'},
 {key:'investments',ar:'الأسهم والاستثمارات الخاضعة',en:'Zakatable shares and investments',hintAr:'حدد معالجة المتاجرة والاستثمار والزكاة المسددة عنها',hintEn:'Determine trading, investment and previously paid zakat treatment'},
 {key:'debtors',ar:'المدينون المرجو تحصيلهم',en:'Collectible receivables',hintAr:'بعد مراجعة معالجة الديون المتعثرة',hintEn:'After reviewing doubtful debt treatment'},
 {key:'other',ar:'موجودات زكوية أخرى',en:'Other zakatable assets',hintAr:'لا تضف الأرباح إذا كانت محتسبة ضمن النقد أو الموجودات',hintEn:'Do not add profits already included in cash or other assets'},
 {key:'due_debts',ar:'التزامات حالة مؤهلة للحسم',en:'Eligible currently due obligations',hintAr:'لا تشمل جميع الأقساط المستقبلية؛ وفق المنهج الموثق',hintEn:'Exclude future installments; use the documented method',deduction:true}],
 SIMPLE:[
 {key:'cash',ar:'النقد والبنوك',en:'Cash and banks',hintAr:'الرصيد في تاريخ التقييم',hintEn:'Balance at valuation'},
 {key:'debtors',ar:'المدينون الخاضعون',en:'Eligible receivables',hintAr:'حسب المعالجة الزكوية المعتمدة',hintEn:'Under the selected zakat policy'},
 {key:'inventory',ar:'المخزون وعروض التجارة',en:'Trading inventory',hintAr:'القيمة الزكوية المعتمدة',hintEn:'Approved zakat valuation'},
 {key:'investments',ar:'الاستثمارات الخاضعة',en:'Zakatable investments',hintAr:'بعد استبعاد الأجزاء المؤهلة للاستبعاد دون تكرار الحسم',hintEn:'Exclude eligible portions once'},
 {key:'other',ar:'موجودات زكوية أخرى',en:'Other zakatable assets',hintAr:'الأصول الثابتة التشغيلية ليست مصروفًا أو أصلًا متداولًا خاضعًا تلقائيًا',hintEn:'Operating fixed assets are not automatically zakatable current assets'},
 {key:'due_debts',ar:'التزامات مؤهلة للحسم',en:'Eligible deductible obligations',hintAr:'وفق المنهج المختار؛ لا تُحسم كل الخصوم تلقائيًا',hintEn:'Under the selected policy; do not automatically deduct all liabilities',deduction:true}],
 SAUDI:[
 {key:'equity',ar:'حقوق الملكية وما في حكمها',en:'Equity and equivalents',hintAr:'تتضمن الربح الدفتري؛ لا تضفه مرة ثانية',hintEn:'Includes book profit; do not add it again'},
 {key:'liabilities',ar:'التزامات مستوفية لشروط الإضافة',en:'Eligible liability additions',hintAr:'مبلغ مؤهل بعد مراجعة التصنيف؛ يحده مجموع المحسومات',hintEn:'Eligible after classification review; limited to deductions'},
 {key:'book_profit',ar:'صافي الربح / الخسارة الدفتري',en:'Book profit / loss',hintAr:'لإظهار فرق التعديل فقط',hintEn:'Used only to determine the adjustment difference',signed:true},
 {key:'adjusted_profit',ar:'صافي الربح / الخسارة المعدل',en:'Adjusted profit / loss',hintAr:'بعد مراجعة التعديلات الزكوية',hintEn:'After reviewing zakat adjustments',signed:true},
 {key:'fixed_assets',ar:'الأصول المؤهلة للحسم',en:'Eligible asset deductions',hintAr:'وفق شروط اللائحة؛ لا يشمل كل أصل غير متداول تلقائيًا',hintEn:'Under regulation conditions; not every noncurrent asset qualifies',deduction:true},
 {key:'deductible_investments',ar:'استثمارات مؤهلة للحسم',en:'Eligible investment deductions',hintAr:'يتطلب تحقق الشروط والمستندات المؤيدة',hintEn:'Requires eligibility and supporting evidence',deduction:true},
 {key:'other_deductions',ar:'محسومات نظامية أخرى',en:'Other eligible deductions',hintAr:'بعد فحص المعالجة الزكوية لكل بند',hintEn:'After reviewing each item',deduction:true}]
};
const models=['PERSONAL','SIMPLE','SAUDI'] as const;
const money=z.number().finite().min(-1e12).max(1e12);
export const manualZakatInputSchema=z.object({
 model:z.enum(models),organization_id:z.string().uuid().nullable(),title:z.string().trim().min(1).max(150),assessment_date:z.string().date(),currency:z.string().regex(/^[A-Z]{3}$/),values:z.record(z.string(),money),
 debt_policy:z.enum(['NONE','DUE']),method_reference:z.string().trim().max(1000),nisab_value:z.number().finite().min(0).max(1e12).nullable(),nisab_reference:z.string().trim().max(300),hawl_completed:z.boolean(),
 period_basis:z.enum(['HIJRI','FINANCIAL']),period_start:z.string().date().nullable(),period_end:z.string().date().nullable(),hijri_days:z.union([z.literal(354),z.literal(355)]),notes:z.string().trim().max(3000),independent_source_confirmed:z.boolean()
}).strict().superRefine((v,c)=>{
 if((v.model==='PERSONAL')!==!v.organization_id)c.addIssue({code:'custom',message:'MANUAL_SCOPE_MODEL_MISMATCH'});
 const allowed=new Map(manualZakatFields[v.model].map(f=>[f.key,f]));for(const [key,value]of Object.entries(v.values)){if(!allowed.has(key)||value<0&&!allowed.get(key)?.signed)c.addIssue({code:'custom',message:'INVALID_MANUAL_VALUES'});}
 if(v.model!=='SAUDI'&&v.debt_policy==='DUE'&&!v.method_reference)c.addIssue({code:'custom',message:'DEBT_METHOD_REQUIRED'});
 if(v.nisab_value&& !v.nisab_reference)c.addIssue({code:'custom',message:'NISAB_REFERENCE_REQUIRED'});
 if(v.period_basis==='FINANCIAL'&&(!v.period_start||!v.period_end||v.period_end<v.period_start||v.period_end!==v.assessment_date))c.addIssue({code:'custom',message:'INVALID_MANUAL_PERIOD'});
 if(v.period_start&&v.period_end&&v.period_start>v.period_end)c.addIssue({code:'custom',message:'INVALID_MANUAL_PERIOD'});
});
export type ManualZakatInput=z.infer<typeof manualZakatInputSchema>;
export function emptyManualZakatInput(model:ManualZakatModel='PERSONAL',organizationId:string|null=null,currency='SAR'):ManualZakatInput{return {model,organization_id:model==='PERSONAL'?null:organizationId,title:'',assessment_date:new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Riyadh'}).format(new Date()),currency,values:{},debt_policy:'NONE',method_reference:'',nisab_value:null,nisab_reference:'',hawl_completed:false,period_basis:'HIJRI',period_start:null,period_end:null,hijri_days:354,notes:'',independent_source_confirmed:false};}
export function calculateManualZakat(input:ManualZakatInput){
 const value=(key:string)=>new Decimal(input.values[key]||0);const fields=manualZakatFields[input.model];
 let additions=new Decimal(0),deductions=fields.filter(f=>f.deduction).reduce((sum,f)=>sum.plus(value(f.key)),new Decimal(0));let profitAdjustment=new Decimal(0),eligibleLiabilities=new Decimal(0);
 if(input.model==='SAUDI'){profitAdjustment=value('adjusted_profit').minus(value('book_profit'));eligibleLiabilities=Decimal.min(value('liabilities'),deductions);additions=value('equity').plus(profitAdjustment).plus(eligibleLiabilities);}else{additions=fields.filter(f=>!f.deduction).reduce((sum,f)=>sum.plus(value(f.key)),new Decimal(0));if(input.debt_policy==='NONE')deductions=new Decimal(0);}
 const rawBase=additions.minus(deductions),base=Decimal.max(rawBase,0);let rate=new Decimal('0.025'),days:number|null=null;
 if(input.period_basis==='FINANCIAL'&&input.period_start&&input.period_end){days=Math.round((Date.parse(input.period_end)-Date.parse(input.period_start))/86400000)+1;rate=rate.div(input.hijri_days).mul(days);}
 const conditions=input.model!=='SAUDI'&&!!input.nisab_value&&input.hawl_completed;const estimate=input.model==='SAUDI'?null:base.mul(rate).toDecimalPlaces(2).toString();
 return {schema_version:1,source:'MANUAL' as const,draft_only:true,status:input.model==='SAUDI'?'REGULATORY_REVIEW' as const:'DRAFT' as const,additions:additions.toDecimalPlaces(2).toString(),deductions:deductions.toDecimalPlaces(2).toString(),raw_base:rawBase.toDecimalPlaces(2).toString(),base:base.toDecimalPlaces(2).toString(),profit_adjustment:profitAdjustment.toDecimalPlaces(2).toString(),eligible_liabilities:eligibleLiabilities.toDecimalPlaces(2).toString(),rate:rate.toString(),period_days:days,estimate,zakat_due:conditions?(base.gte(input.nisab_value!)?estimate:'0.00'):null,conditions_checked:conditions};
}
export type ManualZakatResult=ReturnType<typeof calculateManualZakat>;
