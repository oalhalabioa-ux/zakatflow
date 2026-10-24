import {corporateWorkflowRows} from '../../../../services/corporate-zakat-assessment';
import {NextResponse} from 'next/server';
import {z} from 'zod';
import {requireUser} from '../../../../services/auth';
import {requireOrganizationMember} from '../../../../services/organization-access';
import {manualZakatInputSchema,calculateManualZakat} from '../../../../lib/manual-zakat-assessment';
const headers={'Cache-Control':'no-store'};
const requestSchema=z.object({request_id:z.string().uuid(),input:manualZakatInputSchema}).strict();
function errorResponse(error:unknown){const code=error instanceof Error?error.message:'';return NextResponse.json({error:['UNAUTHORIZED','ORGANIZATION_ACCESS_REQUIRED','MANUAL_ZAKAT_PERMISSION_REQUIRED','MANUAL_REQUEST_CONFLICT'].includes(code)?code:'MANUAL_ASSESSMENT_FAILED'},{status:code==='UNAUTHORIZED'?401:code==='ORGANIZATION_ACCESS_REQUIRED'||code==='MANUAL_ZAKAT_PERMISSION_REQUIRED'?403:code==='MANUAL_REQUEST_CONFLICT'?409:500,headers});}
async function scopeAccess(supabase:any,userId:string,id:string|null,write=false){if(!id)return;await requireOrganizationMember(supabase,userId,id);const r=await supabase.rpc('has_organization_permission',{p_organization_id:id,p_permission:write?'zakat.edit':'zakat.view'});if(r.error)throw r.error;if(!r.data)throw new Error('MANUAL_ZAKAT_PERMISSION_REQUIRED');}
const canonical=(value:any):string=>value&&typeof value==='object'?Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}':JSON.stringify(value);
export async function GET(request:Request){try{
 const {supabase,user}=await requireUser();const raw=new URL(request.url).searchParams.get('organization_id');if(raw&&!z.string().uuid().safeParse(raw).success)return NextResponse.json({error:'INVALID_MANUAL_SCOPE'},{status:400,headers});
 await scopeAccess(supabase,user.id,raw);let q=supabase.from('manual_zakat_assessments').select('*').order('created_at',{ascending:false}).limit(200);q=raw?q.eq('organization_id',raw):q.eq('user_id',user.id).is('organization_id',null);const r=await q;if(r.error)throw r.error;
 const workflows=raw?await corporateWorkflowRows(supabase,raw,(r.data||[]).map((row:any)=>row.id)):[];
 const rows=(r.data||[]).map((row:any)=>({...row,workflow:workflows.find(w=>w.assessment_id===row.id)??null,result:calculateManualZakat(manualZakatInputSchema.parse(row.input))}));return NextResponse.json({rows,limit:200},{headers});
 }catch(e){return errorResponse(e);}}
export async function POST(request:Request){try{
 const {supabase,user}=await requireUser();const parsed=requestSchema.safeParse(await request.json());if(!parsed.success)return NextResponse.json({error:parsed.error.issues[0]?.message||'INVALID_MANUAL_ASSESSMENT'},{status:400,headers});
 const {input,request_id}=parsed.data;await scopeAccess(supabase,user.id,input.organization_id,true);
 const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Riyadh'}).format(new Date());if(input.assessment_date>today)return NextResponse.json({error:'MANUAL_DATE_IN_FUTURE'},{status:400,headers});if(!input.independent_source_confirmed)return NextResponse.json({error:'MANUAL_SOURCE_CONFIRMATION_REQUIRED'},{status:400,headers});
 if(input.source_snapshot_id){const src=await supabase.from('corporate_zakat_sources').select('organization_id,model,assessment_date,currency,period_start').eq('id',input.source_snapshot_id).single();if(src.error||src.data.organization_id!==input.organization_id||src.data.model!==input.model||src.data.assessment_date!==input.assessment_date||src.data.currency!==input.currency||src.data.period_start!==input.period_start)return NextResponse.json({error:'CORPORATE_ZAKAT_SOURCE_MISMATCH'},{status:400,headers});}
 const result=calculateManualZakat(input);const payload={user_id:user.id,organization_id:input.organization_id,request_id,model:input.model,title:input.title,assessment_date:input.assessment_date,currency:input.currency,source:'MANUAL',status:result.status,schema_version:1,input,result};
 const r=await supabase.from('manual_zakat_assessments').insert(payload).select().single();if(r.error){if(r.error.code!=='23505')throw r.error;const existing=await supabase.from('manual_zakat_assessments').select('*').eq('user_id',user.id).eq('request_id',request_id).single();if(existing.error)throw existing.error;if(canonical(existing.data.input)!==canonical(input))throw new Error('MANUAL_REQUEST_CONFLICT');return NextResponse.json({...existing.data,result},{headers});}
 return NextResponse.json({...r.data,result},{status:201,headers});
 }catch(e){if(e instanceof z.ZodError)return NextResponse.json({error:'INVALID_MANUAL_ASSESSMENT'},{status:400,headers});if(e instanceof SyntaxError)return NextResponse.json({error:'INVALID_MANUAL_ASSESSMENT'},{status:400,headers});return errorResponse(e);}}
