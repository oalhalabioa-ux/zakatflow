import {NextResponse} from 'next/server';
import {z,ZodError} from 'zod';
import Decimal from 'decimal.js';
import {requireUser} from '../../../../services/auth';
import {readPersonalProfessionalIncome} from '../../../../services/personal-professional-income';
import {readPersonalReportEvidence} from '../../../../services/personal-report-evidence';
import {readClassifiedPersonalActivity,readPersonalCutoffSources} from '../../../../services/reporting-source-contracts';
import {personalCutoffEvidence,reconcilePersonalClassification} from '../../../../lib/personal-report-v2-sources';
import {financialRegister} from '../../../../services/financial-register';
import {personalFinancialReports} from '../../../../lib/personal-financial-reports';
import {riyadhToday} from '../../../../lib/financial-register';

export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff'};
const query=z.object({from:z.string().date(),to:z.string().date()}).strict().refine(p=>p.from<=p.to&&p.to<=riyadhToday(),{message:'PERSONAL_REPORT_PERIOD_INVALID'});
const professionalTotals=z.object({currency:z.literal('SAR'),net:z.string().regex(/^\d+(?:\.\d{2})?$/),
 tax:z.string().regex(/^\d+(?:\.\d{2})?$/),count:z.number().int().nonnegative()});
const Money=Decimal.clone({precision:40});

async function readProfessionalSources(from:string,to:string){
 const {supabase}=await requireUser();
 const [{data,error},documents]=await Promise.all([
  supabase.rpc('personal_income_period',{p_from:from,p_to:to}),
  readPersonalProfessionalIncome(from,to),
 ]);
 const summary=professionalTotals.safeParse(data);
 if(error||!summary.success||summary.data.count!==documents.length||
  !documents.reduce((total,row)=>total.plus(row.net),new Money(0)).eq(summary.data.net)||
  !documents.reduce((total,row)=>total.plus(row.tax),new Money(0)).eq(summary.data.tax))
  throw Error('PERSONAL_PROFESSIONAL_INCOME_SOURCE_UNAVAILABLE');
 return {professionalIncome:summary.data,professionalIncomeDocuments:documents};
}

/** User's personal books only. No organization or group selector is accepted. */
export async function GET(request:Request){
 try{
  const params=new URL(request.url).searchParams;
  if([...params.keys()].some(key=>!['from','to'].includes(key)||params.getAll(key).length!==1))throw Error('PERSONAL_REPORT_INPUT_INVALID');
  const today=riyadhToday(),period=query.parse({from:params.get('from')??today.slice(0,4)+'-01-01',to:params.get('to')??today});
  const register=await financialRegister('PERSONAL',null,false);
  const [evidence,classified,cutoff,professional]=await Promise.all([
   readPersonalReportEvidence(register,period.to),
   readClassifiedPersonalActivity(period.from,period.to),
   period.to<register.asOf?readPersonalCutoffSources({asOf:period.to}):Promise.resolve(null),
   process.env.NEXT_PUBLIC_PERSONAL_INCOME==='true'?readProfessionalSources(period.from,period.to):undefined,
  ]);
  const classifiedActivity=reconcilePersonalClassification(register,evidence,classified,period);
  const cutoffSources=cutoff?personalCutoffEvidence(cutoff.debts,period.to):undefined;
  return NextResponse.json({...personalFinancialReports(register,period.from,period.to,evidence),classifiedActivity,cutoffSources,...professional},{headers});
 }catch(error){
  const message=error instanceof Error?error.message:'',status=message==='UNAUTHORIZED'?401:error instanceof ZodError||/PERSONAL_REPORT_(PERIOD|INPUT)_INVALID/.test(message)?400:503;
  return NextResponse.json({error:status===401?'UNAUTHORIZED':status===400?'PERSONAL_REPORT_INPUT_INVALID':'PERSONAL_REPORT_UNAVAILABLE'},{status,headers});
 }
}
