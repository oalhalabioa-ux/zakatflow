import {isSameOriginRequest} from '../../../lib/request-origin';
import {NextResponse} from 'next/server';
import {z} from 'zod';
import {financingAction,financingCharges} from '../../../services/financing-contracts';
import {financingSettlementAction,financingSettlementRequests} from '../../../services/financing-settlements';
const headers={'Cache-Control':'no-store'};
function failure(e:unknown){const m=e instanceof z.ZodError?'VALIDATION_FAILED':e instanceof Error?e.message:'';const error=/^[A-Z][A-Z_]+$/.test(m)?m:'FINANCING_FAILED';return NextResponse.json({error},{status:error==='UNAUTHORIZED'?401:/DENIED|ACCESS/.test(error)?403:error==='FINANCING_FAILED'?500:400,headers});}
export async function GET(r:Request){try{const q=new URL(r.url).searchParams;const org=q.get('organization_id')??'',id=q.get('contract_id')??'';const [charges,settlements]=await Promise.all([financingCharges(org,id),financingSettlementRequests(org,id)]);return NextResponse.json({...charges,settlements},{headers})}catch(e){return failure(e)}}
export async function POST(r:Request){try{if(!isSameOriginRequest(r))return NextResponse.json({error:'ORIGIN_REQUIRED'},{status:403,headers});const input=await r.json();return NextResponse.json(await (String(input.action).endsWith('_INSTALLMENT')?financingSettlementAction:financingAction)(input),{headers})}catch(e){return failure(e)}}
