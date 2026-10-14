import {NextResponse} from 'next/server';
import {z} from 'zod';
import {advanceWorkspace,advanceAction} from '../../../services/advances';
const headers={'Cache-Control':'no-store'};
function failure(e:unknown){const raw=e instanceof z.ZodError?'VALIDATION_FAILED':e&&typeof e==='object'&&'message'in e?String(e.message):'';const code=/^[A-Z][A-Z_]+$/.test(raw)?raw:'ADVANCE_REQUEST_FAILED';return NextResponse.json({error:code},{status:code==='UNAUTHORIZED'?401:/DENIED|ACCESS/.test(code)?403:code==='ADVANCE_REQUEST_FAILED'?500:400,headers});}
export async function GET(request:Request){try{return NextResponse.json(await advanceWorkspace(new URL(request.url).searchParams.get('organization_id')??''),{headers});}catch(e){return failure(e);}}
export async function POST(request:Request){try{if(request.headers.get('origin')!==new URL(request.url).origin)return NextResponse.json({error:'ORIGIN_REQUIRED'},{status:403,headers});return NextResponse.json(await advanceAction(new URL(request.url).searchParams.get('organization_id')??'',await request.json()),{headers});}catch(e){return failure(e);}}
