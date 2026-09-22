import {NextResponse} from 'next/server';
import {createCostCenter,listCostCenters,updateCostCenter} from '@/services/organizations';

export async function GET(request:Request){
 try{
  const organizationId=new URL(request.url).searchParams.get('organization_id');
  if(!organizationId)return NextResponse.json({error:'organization_id required'},{status:400});
  return NextResponse.json(await listCostCenters(organizationId));
 }catch(error:any){return NextResponse.json({error:error.message},{status:error.message==='UNAUTHORIZED'?401:400})}
}

export async function POST(request:Request){
 try{return NextResponse.json(await createCostCenter(await request.json()),{status:201})}
 catch(error:any){return NextResponse.json({error:error.message},{status:error.message==='UNAUTHORIZED'?401:400})}
}

export async function PATCH(request:Request){
 try{const body=await request.json();return NextResponse.json(await updateCostCenter(body.id,body))}
 catch(error:any){return NextResponse.json({error:error.message},{status:error.message==='UNAUTHORIZED'?401:400})}
}
