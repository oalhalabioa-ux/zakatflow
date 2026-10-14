import {NextResponse} from 'next/server';
import {z} from 'zod';
import {financialRegister} from '../../../services/financial-register';
import {requireUser} from '../../../services/auth';
import {openingFinancialAccountSchema,personalCashTransferSchema,riyadhToday} from '../../../lib/financial-register';
const headers={'Cache-Control':'no-store'};
const status=(code:string)=>code==='UNAUTHORIZED'?401:/ACCESS|PERMISSION|DENIED/.test(code)?403:/FAILED$/.test(code)&&code!=='VALIDATION_FAILED'?500:400;
const errorCode=(e:unknown,fallback:string)=>{if(e instanceof z.ZodError)return 'VALIDATION_FAILED';const message=e&&typeof e==='object'&&'message' in e?String(e.message):'';return /^[A-Z][A-Z_]+$/.test(message)?message:fallback;};
export async function GET(request:Request){try{const q=new URL(request.url).searchParams;const scope=z.enum(['PERSONAL','ORGANIZATION']).parse(q.get('scope')??'PERSONAL');const id=q.get('organization_id');if(id)z.string().uuid().parse(id);return NextResponse.json(await financialRegister(scope,id,q.get('group')==='1'),{headers});}catch(e){const code=errorCode(e,'REPORT_LOAD_FAILED');return NextResponse.json({error:code},{status:status(code),headers});}}
export async function POST(request:Request){try{const body=await request.json(),transfer=['TRANSFER','COLLECT'].includes(body.action);const p=transfer?personalCashTransferSchema.parse(body):openingFinancialAccountSchema.parse(body);if((transfer?(p as any).date:(p as any).opening_date)>riyadhToday())throw new Error('OPENING_DATE_IN_FUTURE');const {supabase}=await requireUser();const {data,error}=await supabase.rpc(transfer?'transfer_personal_financial_account':'open_financial_account',{p_payload:p});if(error)throw error;return NextResponse.json(data,{status:201,headers});}catch(e){const code=errorCode(e,'ACCOUNT_OPENING_FAILED');return NextResponse.json({error:code},{status:status(code),headers});}}
