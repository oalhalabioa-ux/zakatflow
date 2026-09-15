import { NextResponse } from 'next/server'; import { listLots } from '@/services/lots';
export async function GET(){try{return NextResponse.json(await listLots())}catch(e:any){return NextResponse.json({error:e.message},{status:e.message==='UNAUTHORIZED'?401:500})}}
