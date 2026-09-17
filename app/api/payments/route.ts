import { NextResponse } from 'next/server'; import { createPayment,listPayments,updatePayment } from '@/services/payments';
export async function GET(){try{return NextResponse.json(await listPayments())}catch(e:any){return NextResponse.json({error:e.message},{status:e.message==='UNAUTHORIZED'?401:500})}}
export async function POST(req:Request){try{return NextResponse.json(await createPayment(await req.json()),{status:201})}catch(e:any){return NextResponse.json({error:e.message},{status:400})}}
export async function PUT(req:Request){try{return NextResponse.json(await updatePayment(await req.json()))}catch(e:any){return NextResponse.json({error:e.message},{status:e.message==='UNAUTHORIZED'?401:400})}}
