import {NextResponse} from 'next/server';
import {createCase,listCases,moveCase} from '@/services/workflow';
export async function GET(){try{return NextResponse.json(await listCases())}catch(e){return NextResponse.json({error:(e as Error).message},{status:401})}}
export async function POST(req:Request){try{const b=await req.json(); if(b.action==='transition') return NextResponse.json(await moveCase(b.id,b.to,b.comment)); return NextResponse.json(await createCase(b),{status:201})}catch(e){return NextResponse.json({error:(e as Error).message},{status:400})}}
