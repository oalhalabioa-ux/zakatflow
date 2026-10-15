import {NextResponse} from 'next/server';
import {z} from 'zod';
import {requireUser} from '../../../services/auth';
import {financialRegister} from '../../../services/financial-register';
import {personalFinancingSchema} from '../../../lib/personal-financing';
const headers={'Cache-Control':'no-store'};
function failure(e:unknown){const m=e instanceof z.ZodError?'VALIDATION_FAILED':e&&typeof e==='object'&&'message'in e?String(e.message):'';const error=/^[A-Z][A-Z_]+$/.test(m)?m:'PERSONAL_FINANCING_FAILED';return NextResponse.json({error},{status:error==='UNAUTHORIZED'?401:/DENIED|ACCESS/.test(error)?403:error==='PERSONAL_FINANCING_FAILED'?500:400,headers})}
export async function GET(){try{const {supabase,user}=await requireUser();const [register,result]=await Promise.all([financialRegister('PERSONAL',null,false,true),supabase.from('personal_financings').select('*').eq('user_id',user.id).order('created_at',{ascending:false})]);if(result.error)throw result.error;return NextResponse.json({register,records:result.data},{headers})}catch(e){return failure(e)}}
export async function POST(r:Request){try{if(r.headers.get('origin')!==new URL(r.url).origin)return NextResponse.json({error:'ORIGIN_REQUIRED'},{status:403,headers});const command=personalFinancingSchema.parse(await r.json()),{supabase}=await requireUser();const {data,error}=await supabase.rpc('personal_financing_command',{p_payload:command});if(error)throw error;return NextResponse.json(data,{headers})}catch(e){return failure(e)}}
