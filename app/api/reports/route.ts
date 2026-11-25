import {NextResponse} from 'next/server';
import {z} from 'zod';
import {requireUser} from '../../../services/auth';
import {readOperationalReport} from '../../../services/operational-reports';
import {operationalReportTypes,readOperationalReportScope} from '../../../lib/operational-report-scope';
import {reportCsv} from '../../../lib/vat-financial-reports';
const headers={'Cache-Control':'no-store'};
export async function GET(req:Request){
 try{
  const q=new URL(req.url).searchParams;
  if(q.getAll('type').length>1)throw Error('REPORT_TYPE_INVALID');
  const type=z.enum(operationalReportTypes).parse(q.get('type')??'assessments');
  const scope=readOperationalReportScope(q),rows=await readOperationalReport(type,scope);
  const keys=[...new Set(rows.flatMap(row=>Object.keys(row)))];
  const csv=reportCsv(keys.length?[keys,...rows.map(row=>keys.map(key=>typeof row[key]==='number'?row[key]:String(row[key]??'')))]:[]);
  return new NextResponse(csv,{headers:{...headers,'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="yaqeen-${type}-${scope.scope.toLowerCase()}.csv"`}});
 }catch(error){
  const raw=error instanceof Error?error.message:String((error as {message?:string})?.message??'');
  const code=error instanceof z.ZodError?'REPORT_INPUT_INVALID':/^[A-Z][A-Z_]+$/.test(raw)?raw:'REPORT_LOAD_FAILED';
  return NextResponse.json({error:code},{status:code==='UNAUTHORIZED'?401:/ACCESS|PERMISSION|DENIED/.test(code)?403:code==='REPORT_LOAD_FAILED'?500:400,headers});
 }
}
export async function POST(req:Request){try{const {supabase,user}=await requireUser();const b=await req.json();const {data,error}=await supabase.from('report_jobs').insert({owner_id:user.id,report_type:b.report_type??'ZAKAT',format:b.format??'PDF',reference_id:b.assessment_id??null,status:'QUEUED'}).select().single();if(error)throw error;return NextResponse.json(data,{status:201})}catch(e:any){return NextResponse.json({error:e.message},{status:400})}}

