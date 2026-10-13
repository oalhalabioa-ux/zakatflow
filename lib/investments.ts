import Decimal from 'decimal.js';
import {z} from 'zod';
import {tabularHijriYearSegments} from '../engine/hawl';
const money=z.number().finite().min(0).max(1e12);
const optionalId=z.string().uuid().nullable().default(null);
export const investmentTermsSchema=z.object({
 name:z.string().trim().min(1).max(120),instrument:z.enum(['DEPOSIT','BOND','SUKUK']),
 ownership_scope:z.enum(['PERSONAL','ORGANIZATION']),organization_id:optionalId,entity_id:optionalId,cost_center_id:optionalId,
 party_name:z.string().trim().min(1).max(160),currency:z.string().regex(/^[A-Z]{3}$/),
 principal:money.positive(),face_value:money.positive(),fees:money,annual_rate:z.number().finite().min(0).max(100),
 start_date:z.string().date(),maturity_date:z.string().date(),interest_basis:z.enum(['ACT_365','ACT_360']),
 zakat_basis:z.enum(['HIJRI_354','HIJRI_TABULAR']),zakat_rate:z.number().finite().min(0).max(100),zakat_base:money,
 zakat_treatment:z.enum(['INVESTOR','DEDUCTED','COVERED']),inflation_rate:z.number().finite().min(-99).max(1000),
 zakat_assessment_mode:z.enum(['INTERNAL','INSTITUTION_COVERED']).default('INTERNAL'),
 zakat_coverage_from:z.string().default(''),zakat_coverage_to:z.string().default(''),zakat_coverage_reference:z.string().trim().max(200).default(''),
 fx_rate:z.number().finite().positive().max(1e6),funding_account_id:z.string().uuid(),
 reference:z.string().trim().max(200).default(''),notes:z.string().trim().max(2000).default('')
}).strict().superRefine((t,c)=>{
 const days=(Date.parse(t.maturity_date)-Date.parse(t.start_date))/86400000;
 if(days<=0||days>18250)c.addIssue({code:'custom',path:['maturity_date'],message:'مدة الاستثمار غير صالحة'});
 if(t.ownership_scope==='ORGANIZATION'&&!t.organization_id)c.addIssue({code:'custom',path:['organization_id'],message:'اختر المؤسسة'});
 if(t.ownership_scope==='PERSONAL'&&(t.organization_id||t.entity_id||t.cost_center_id))c.addIssue({code:'custom',message:'نطاق شخصي غير صالح'});
 if(t.instrument==='DEPOSIT'&&t.face_value!==t.principal)c.addIssue({code:'custom',path:['face_value'],message:'قيمة استرداد الوديعة تساوي رأس المال'});
 if(t.zakat_assessment_mode==='INSTITUTION_COVERED'){
  if(t.instrument!=='DEPOSIT'||t.zakat_treatment!=='COVERED'||t.zakat_base!==t.principal)c.addIssue({code:'custom',message:'التغطية الخارجية لرأس مال الوديعة بالكامل مع تحمل الجهة للزكاة'});
  if(!z.string().date().safeParse(t.zakat_coverage_from).success||!z.string().date().safeParse(t.zakat_coverage_to).success||t.zakat_coverage_from<t.start_date||t.zakat_coverage_to>t.maturity_date||t.zakat_coverage_to<=t.zakat_coverage_from)c.addIssue({code:'custom',message:'حدد فترة تغطية صحيحة ضمن مدة الوديعة'});
  if(!t.zakat_coverage_reference)c.addIssue({code:'custom',path:['zakat_coverage_reference'],message:'مرجع إثبات التغطية لدى الجهة مطلوب'});
 }else if(t.zakat_coverage_from||t.zakat_coverage_to||t.zakat_coverage_reference)c.addIssue({code:'custom',message:'حقول التغطية تخص خيار مزكّى عنه لدى الجهة'});
});
export type InvestmentTerms=z.infer<typeof investmentTermsSchema>;
export function investmentProjection(t:InvestmentTerms){
 const days=(Date.parse(t.maturity_date)-Date.parse(t.start_date))/86400000;
 const zakatSegments=t.zakat_basis==='HIJRI_TABULAR'?tabularHijriYearSegments(t.start_date,t.maturity_date):[{year:null,days,yearDays:354}];
 const fraction=zakatSegments.reduce((a,s)=>a.plus(new Decimal(s.days).div(s.yearDays)),new Decimal(0));
 const zakat=new Decimal(t.zakat_base).times(t.zakat_rate).div(100).times(fraction).toDecimalPlaces(4).toNumber();
 const coupon=new Decimal(t.instrument==='DEPOSIT'?t.principal:t.face_value).times(t.annual_rate).div(100).times(days).div(t.interest_basis==='ACT_360'?360:365).toDecimalPlaces(4).toNumber();
 const cost=t.principal+t.fees,redemption=t.face_value,capitalGain=redemption-t.principal,gross=coupon+capitalGain;
 const net=new Decimal(gross).minus(t.fees).minus(t.zakat_treatment==='COVERED'?0:zakat).toDecimalPlaces(4).toNumber();
 const periodInflation=Math.pow(1+t.inflation_rate/100,days/365)-1;
 return {days,zakatSegments,zakat,coupon,cost,redemption,capitalGain,gross,net,netRate:net/cost*100,realRate:((1+net/cost)/(1+periodInflation)-1)*100,periodInflation:periodInflation*100,maturityGross:redemption+coupon,coveredBenefit:t.zakat_treatment==='COVERED'?zakat:0};
}
export const investmentOperationSchema=z.object({
 contract_id:z.string().uuid(),request_id:z.string().uuid(),kind:z.enum(['FUND','INCOME','REDEEM']),date:z.string().date(),
 account_id:z.string().uuid(),amount:money.positive(),withheld_zakat:money.default(0),notes:z.string().trim().min(1).max(2000),fx_rate:z.number().finite().positive().max(1e6)
}).strict();
export function investmentStatusLabel(status:string,ar=true){
 const labels:Record<string,string>={DRAFT:'مسودة',ACTIVE:'نشط',CLOSED:'مسترد',CANCELLED:'ملغى',PREPARED:'بانتظار الاعتماد',APPROVED:'معتمد — بانتظار التنفيذ',POSTED:'منفذ'};
 return ar?(labels[status]??status):status;
}
