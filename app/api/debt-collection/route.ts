import {NextResponse} from 'next/server';
import {z} from 'zod';
import {debtCollectionWorkspace,recordDebtFollowup} from '../../../services/debt-collection';
const headers={'Cache-Control':'no-store'};
function fail(e:unknown){const raw=e instanceof z.ZodError?'VALIDATION_FAILED':e instanceof Error?e.message:'';const error=/^[A-Z][A-Z_]+$/.test(raw)?raw:'COLLECTION_FAILED';return NextResponse.json({error},{status:error==='UNAUTHORIZED'?401:/DENIED|ACCESS/.test(error)?403:error==='COLLECTION_FAILED'?500:400,headers});}
export async function GET(r:Request){try{const q=new URL(r.url).searchParams,scope=z.enum(['PERSONAL','ORGANIZATION']).parse(q.get('scope'));return NextResponse.json(await debtCollectionWorkspace(scope,q.get('organization_id'),q.get('group')==='1'),{headers})}catch(e){return fail(e)}}
export async function POST(r:Request){try{if(r.headers.get('origin')!==new URL(r.url).origin)return NextResponse.json({error:'ORIGIN_REQUIRED'},{status:403,headers});return NextResponse.json(await recordDebtFollowup(await r.json()),{headers})}catch(e){return fail(e)}}
