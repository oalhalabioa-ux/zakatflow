import {NextResponse} from 'next/server';
import {z} from 'zod';
import {debtPayrollWorkspace,debtPayrollAction} from '../../../services/debt-payroll';
const headers={'Cache-Control':'no-store'};
function fail(e:unknown){const raw=e instanceof z.ZodError?'VALIDATION_FAILED':e instanceof Error?e.message:'';const error=/^[A-Z][A-Z_]+$/.test(raw)?raw:'PAYROLL_FAILED';return NextResponse.json({error},{status:error==='UNAUTHORIZED'?401:/DENIED|ACCESS/.test(error)?403:error==='PAYROLL_FAILED'?500:400,headers});}
export async function GET(r:Request){try{return NextResponse.json(await debtPayrollWorkspace(new URL(r.url).searchParams.get('organization_id')??''),{headers})}catch(e){return fail(e)}}
export async function POST(r:Request){try{if(r.headers.get('origin')!==new URL(r.url).origin)return NextResponse.json({error:'ORIGIN_REQUIRED'},{status:403,headers});return NextResponse.json(await debtPayrollAction(await r.json()),{headers})}catch(e){return fail(e)}}
