import { NextResponse } from 'next/server';
import { reverseTransaction } from '@/services/transactions';
export async function POST(req:Request){try{const {id}=await req.json();return NextResponse.json(await reverseTransaction(id),{status:201})}catch(e:any){return NextResponse.json({error:e.message},{status:e.message==='UNAUTHORIZED'?401:400})}}
