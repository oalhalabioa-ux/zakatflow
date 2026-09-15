import {NextResponse} from 'next/server';import {getSettings,updateSettings} from '@/services/settings';
export async function GET(){try{return NextResponse.json(await getSettings())}catch(e:any){return NextResponse.json({error:e.message},{status:e.message==='UNAUTHORIZED'?401:500})}}
export async function PUT(req:Request){try{return NextResponse.json(await updateSettings(await req.json()))}catch(e:any){return NextResponse.json({error:e.message},{status:e.message==='UNAUTHORIZED'?401:400})}}
