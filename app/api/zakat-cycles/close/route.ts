import {NextResponse} from 'next/server';
import {closeCycle,startNextCycle} from '@/services/zakat-cycles';
export async function POST(req:Request){try{const{cycle_id,assessment_id,start_next_cycle=true}=await req.json();if(!cycle_id)return NextResponse.json({error:'CYCLE_ID_REQUIRED'},{status:400});const closed=await closeCycle(cycle_id,assessment_id);const next=start_next_cycle?await startNextCycle(cycle_id):null;return NextResponse.json({closed,next})}catch(e:any){return NextResponse.json({error:e.message},{status:e.message==='UNAUTHORIZED'?401:400})}}
