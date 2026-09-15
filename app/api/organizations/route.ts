import {NextResponse} from 'next/server';import {createOrganization,listOrganizations} from '@/services/organizations';
export async function GET(){try{return NextResponse.json(await listOrganizations())}catch(e:any){return NextResponse.json({error:e.message},{status:e.message==='UNAUTHORIZED'?401:400})}}
export async function POST(req:Request){try{return NextResponse.json(await createOrganization(await req.json()),{status:201})}catch(e:any){return NextResponse.json({error:e.message},{status:e.message==='UNAUTHORIZED'?401:400})}}
