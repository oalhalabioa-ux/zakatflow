import {NextResponse} from 'next/server';
import {markHistoricalCycleSettled} from '@/services/zakat-cycles';
export async function POST(req:Request){try{const{id}=await req.json();if(!id)return NextResponse.json({error:'CYCLE_ID_REQUIRED'},{status:400});return NextResponse.json(await markHistoricalCycleSettled(id))}catch(e:any){const status=e.message==='UNAUTHORIZED'?401:['ACTIVE_CYCLE_CANNOT_BE_HISTORICALLY_SETTLED','CYCLE_HAS_RECORDED_PAYMENTS'].includes(e.message)?409:400;return NextResponse.json({error:e.message},{status})}}
