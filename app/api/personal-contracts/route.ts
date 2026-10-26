import {NextResponse} from 'next/server';
import {z} from 'zod';
import {personalContractAction,personalContractsWorkspace} from '../../../services/personal-contracts';
import {isSameOriginRequest} from '../../../lib/request-origin';
const headers={'Cache-Control':'no-store'};
function fail(e:unknown){const message=e instanceof z.ZodError?'VALIDATION_FAILED':e&&typeof e==='object'&&'message'in e?String(e.message):'';const code=/^[A-Z][A-Z_]+$/.test(message)?message:'PERSONAL_CONTRACT_FAILED';return NextResponse.json({error:code},{status:code==='UNAUTHORIZED'?401:/DENIED|ACCESS/.test(code)?403:code==='PERSONAL_CONTRACT_FAILED'?500:400,headers});}
export async function GET(){try{return NextResponse.json(await personalContractsWorkspace(),{headers})}catch(e){return fail(e)}}
export async function POST(r:Request){try{if(!isSameOriginRequest(r))return NextResponse.json({error:'ORIGIN_REQUIRED'},{status:403,headers});return NextResponse.json(await personalContractAction(await r.json()),{headers})}catch(e){return fail(e)}}
