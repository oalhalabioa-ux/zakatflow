import {NextResponse} from 'next/server';
import {listPaymentCycles} from '@/services/payments';
export async function GET(){try{return NextResponse.json(await listPaymentCycles())}catch(e:any){return NextResponse.json({error:e.message},{status:e.message==='UNAUTHORIZED'?401:500})}}
