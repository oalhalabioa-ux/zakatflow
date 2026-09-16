import { NextResponse } from 'next/server';
import { createAsset,listAssets,updateAsset } from '@/services/assets';

export async function GET(){
  try{return NextResponse.json(await listAssets())}
  catch(e:any){return NextResponse.json({error:e.message},{status:e.message==='UNAUTHORIZED'?401:500})}
}

export async function POST(req:Request){
  try{return NextResponse.json(await createAsset(await req.json()),{status:201})}
  catch(e:any){return NextResponse.json({error:e.message},{status:400})}
}

export async function PUT(req:Request){
  try{
    const body=await req.json();
    const {id,...input}=body;
    if(!id) return NextResponse.json({error:'ASSET_ID_REQUIRED'},{status:400});
    return NextResponse.json(await updateAsset(id,input));
  }catch(e:any){return NextResponse.json({error:e.message},{status:e.message==='UNAUTHORIZED'?401:400})}
}
