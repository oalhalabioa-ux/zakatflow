import {NextResponse} from 'next/server';import {startFirstCycle} from '@/services/zakat-cycles';
export async function POST(req:Request){try{return NextResponse.json(await startFirstCycle(await req.json()),{status:201})}catch(e:any){return NextResponse.json({error:e.message},{status:e.message==='UNAUTHORIZED'?401:400})}}
