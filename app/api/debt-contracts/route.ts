import {NextResponse} from 'next/server';
import {z} from 'zod';
import {debtContracts,debtContractAction} from '../../../services/debt-contracts';
const headers={'Cache-Control':'no-store'};
function failure(e:unknown){const m=e instanceof z.ZodError?'VALIDATION_FAILED':e&&typeof e==='object'&&'message'in e?String(e.message):'';const error=/^[A-Z][A-Z_]+$/.test(m)?m:'DEBT_CONTRACT_FAILED';return NextResponse.json({error},{status:error==='UNAUTHORIZED'?401:/DENIED|ACCESS/.test(error)?403:error==='DEBT_CONTRACT_FAILED'?500:400,headers});}
export async function GET(r:Request){try{return NextResponse.json(await debtContracts(new URL(r.url).searchParams.get('organization_id')??''),{headers});}catch(e){return failure(e);}}
export async function POST(r:Request){try{if(r.headers.get('origin')!==new URL(r.url).origin)return NextResponse.json({error:'ORIGIN_REQUIRED'},{status:403,headers});return NextResponse.json(await debtContractAction(await r.json()),{headers});}catch(e){return failure(e);}}
