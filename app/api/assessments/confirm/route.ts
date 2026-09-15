import { NextResponse } from 'next/server';
import { confirmAssessment } from '@/services/assessments';
export async function POST(req:Request){try{const {id}=await req.json();return NextResponse.json(await confirmAssessment(id))}catch(e:any){return NextResponse.json({error:e.message},{status:e.message==='UNAUTHORIZED'?401:400})}}
