import { NextResponse } from 'next/server'; import { createTransaction,listTransactions } from '@/services/transactions';
export async function GET(){try{return NextResponse.json(await listTransactions())}catch(e:any){return NextResponse.json({error:e.message},{status:e.message==='UNAUTHORIZED'?401:500})}}
export async function POST(req:Request){try{return NextResponse.json(await createTransaction(await req.json()),{status:201})}catch(e:any){return NextResponse.json({error:e.message},{status:400})}}
