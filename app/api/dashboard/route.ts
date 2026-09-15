import {NextResponse} from 'next/server';
import {getDashboard} from '@/services/dashboard';
export async function GET(){try{return NextResponse.json(await getDashboard())}catch(e:any){return NextResponse.json({error:e.message},{status:e.message==='UNAUTHORIZED'?401:500})}}
