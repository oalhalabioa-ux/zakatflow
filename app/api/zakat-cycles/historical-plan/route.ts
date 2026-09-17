import {NextResponse} from 'next/server';
import {previewHistoricalCycles,applyHistoricalCycles} from '@/services/zakat-cycles';
export async function POST(req:Request){try{const body=await req.json();const data=body?.apply?await applyHistoricalCycles(body):await previewHistoricalCycles(body);return NextResponse.json(data,{status:body?.apply?201:200})}catch(e:any){return NextResponse.json({error:e.message},{status:e.message==='UNAUTHORIZED'?401:400})}}
