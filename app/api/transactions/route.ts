import { NextResponse } from 'next/server'; import { createTransaction,listTransactions,deleteUnlinkedAssetTransaction,restoreUnlinkedAssetTransaction } from '@/services/transactions';
export async function GET(req:Request){try{return NextResponse.json(await listTransactions(new URL(req.url).searchParams.get("deleted")==="true"))}catch(e:any){return NextResponse.json({error:e.message},{status:e.message==='UNAUTHORIZED'?401:500})}}
export async function POST(req:Request){try{return NextResponse.json(await createTransaction(await req.json()),{status:201})}catch(e:any){return NextResponse.json({error:e.message},{status:400})}}

export async function DELETE(req:Request){try{const{id}=await req.json();if(!id)return NextResponse.json({error:"TRANSACTION_ID_REQUIRED"},{status:400});return NextResponse.json(await deleteUnlinkedAssetTransaction(id));}catch(e:any){return NextResponse.json({error:e.message},{status:e.message==="UNAUTHORIZED"?401:400});}}

export async function PATCH(req:Request){try{const{id}=await req.json();if(!id)return NextResponse.json({error:"TRANSACTION_ID_REQUIRED"},{status:400});return NextResponse.json(await restoreUnlinkedAssetTransaction(id));}catch(e:any){return NextResponse.json({error:e.message},{status:e.message==="UNAUTHORIZED"?401:400});}}
