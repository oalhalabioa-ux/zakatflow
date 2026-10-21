import {NextResponse} from 'next/server';
import {z} from 'zod';
import {debtPartyDirectory,mutateDebtParty} from '../../../services/debt-party-directory';
import {partyScopeSchema} from '../../../lib/debt-party-directory';
const headers={'Cache-Control':'no-store'};
function failure(e:unknown){const message=e instanceof z.ZodError?'VALIDATION_FAILED':e&&typeof e==='object'&&'message'in e?String(e.message):'';const rawCode=e&&typeof e==='object'&&'code'in e?String(e.code):'';const error=rawCode==='23503'?'PARTY_IN_USE':/^[A-Z][A-Z_]+$/.test(message)?message:'PARTY_DIRECTORY_FAILED';return NextResponse.json({error},{status:error==='UNAUTHORIZED'?401:/DENIED|ACCESS_REQUIRED/.test(error)?403:error==='PARTY_IN_USE'||error==='PARTY_ARCHIVED'?409:error==='PARTY_DIRECTORY_FAILED'?500:400,headers});}
export async function GET(r:Request){try{const q=new URL(r.url).searchParams,scope=partyScopeSchema.parse(q.get('scope')??'PERSONAL'),org=q.get('organization_id');if(org)z.string().uuid().parse(org);return NextResponse.json(await debtPartyDirectory(scope,org,q.get('group')==='1'),{headers});}catch(e){return failure(e);}}
export async function POST(r:Request){try{if(r.headers.get('origin')!==new URL(r.url).origin)return NextResponse.json({error:'ORIGIN_REQUIRED'},{status:403,headers});return NextResponse.json(await mutateDebtParty(await r.json()),{headers});}catch(e){return failure(e);}}
