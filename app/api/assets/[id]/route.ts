import {NextResponse} from 'next/server';
import {deleteAsset} from '@/services/assets';

export async function DELETE(_req:Request,{params}:{params:Promise<{id:string}>}){
 try{
  const{id}=await params;
  return NextResponse.json(await deleteAsset(id));
 }catch(e:any){
  const status=e.message==='UNAUTHORIZED'?401:e.message==='ASSET_NOT_FOUND'?404:e.message==='ASSET_PROTECTED'?409:400;
  return NextResponse.json({error:e.message,linked:e.linked??null},{status});
 }
}
