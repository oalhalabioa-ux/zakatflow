import { NextRequest, NextResponse } from 'next/server';
import { createOrganization, createEntity } from '@/services/enterprise';
export async function POST(req:NextRequest){try{const body=await req.json(); if(body.action==='organization') return NextResponse.json(await createOrganization(body)); if(body.action==='entity') return NextResponse.json(await createEntity(body)); return NextResponse.json({error:'Unknown action'},{status:400});}catch(e:any){return NextResponse.json({error:e.message},{status:400});}}
