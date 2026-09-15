import { NextResponse } from 'next/server';
import { calculateAndSaveAssessment, listAssessments } from '@/services/assessments';
export async function GET(){try{return NextResponse.json(await listAssessments())}catch(e:any){return NextResponse.json({error:e.message},{status:e.message==='UNAUTHORIZED'?401:500})}}
export async function POST(req:Request){try{return NextResponse.json(await calculateAndSaveAssessment(await req.json()),{status:201})}catch(e:any){return NextResponse.json({error:e.message},{status:e.message==='UNAUTHORIZED'?401:400})}}
