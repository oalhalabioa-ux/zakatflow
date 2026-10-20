import {NextResponse} from 'next/server';import {z} from 'zod';
import {participationWorkspace,participationAction} from '../../../services/participation-contracts';
const headers={'Cache-Control':'no-store'};
function failure(e:unknown){const m=e instanceof z.ZodError?'VALIDATION_FAILED':e instanceof Error?e.message:'';const error=/^[A-Z][A-Z_]+$/.test(m)?m:'PARTICIPATION_FAILED';return NextResponse.json({error},{status:error==='UNAUTHORIZED'?401:/DENIED|ACCESS/.test(error)?403:error==='PARTICIPATION_FAILED'?500:400,headers})}
export async function GET(r:Request){try{const q=new URL(r.url).searchParams;return NextResponse.json(await participationWorkspace(q.get('organization_id')??'',q.get('group')==='1'),{headers})}catch(e){return failure(e)}}
export async function POST(r:Request){try{if(r.headers.get('origin')!==new URL(r.url).origin)return NextResponse.json({error:'ORIGIN_REQUIRED'},{status:403,headers});return NextResponse.json(await participationAction(await r.json()),{headers})}catch(e){return failure(e)}}
