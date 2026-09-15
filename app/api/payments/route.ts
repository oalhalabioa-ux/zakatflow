import { NextResponse } from 'next/server'; import { createPayment,listPayments } from '@/services/payments';
export async function GET(){try{return NextResponse.json(await listPayments())}catch(e:any){return NextResponse.json({error:e.message},{status:e.message==='UNAUTHORIZED'?401:500})}}
export async function POST(req:Request){try{return NextResponse.json(await createPayment(await req.json()),{status:201})}catch(e:any){return NextResponse.json({error:e.message},{status:400})}}
