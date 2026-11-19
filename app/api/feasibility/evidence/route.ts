import {NextResponse} from 'next/server';
import {z} from 'zod';
import {isSameOriginRequest} from '@/lib/request-origin';
import {supabaseServer} from '@/lib/supabase/server';
import {feasibilityEvidenceEnabled} from '@/lib/feasibility/evidence-config';

export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};
const json=(data:unknown,status=200)=>NextResponse.json(data,{status,headers});
const querySchema=z.object({
 project:z.string().uuid(),organization:z.string().uuid().nullable(),
 kind:z.enum(['licensing','valuation']),document:z.string().uuid().nullable(),
});
const maxBytes=2*1024*1024;
const mediaTypes=new Set(['application/pdf','image/png','image/jpeg']);

async function handle(request:Request){
 if(!feasibilityEvidenceEnabled())return json({error:'EVIDENCE_DISABLED'},404);
 const writing=request.method!=='GET';
 if(writing&&!isSameOriginRequest(request))return json({error:'INVALID_ORIGIN'},403);
 const params=new URL(request.url).searchParams;
 const parsed=querySchema.safeParse({
  project:params.get('project'),organization:params.get('organization'),
  kind:params.get('kind'),document:params.get('document'),
 });
 if(!parsed.success)return json({error:'INVALID_EVIDENCE_SCOPE'},400);
 const {project,organization,kind,document}=parsed.data;
 if(organization&&!(process.env.FEASIBILITY_ORG_QA==='true'&&process.env.FEASIBILITY_ORG_SHARING==='true'))
  return json({error:'EVIDENCE_DISABLED'},404);
 const action=request.method==='POST'?'upload':request.method==='DELETE'?'remove':document?'download':'list';
 if(action==='remove'&&!document)return json({error:'INVALID_DOCUMENT'},400);
 const supabase=await supabaseServer();
 const {data:{user},error:authError}=await supabase.auth.getUser();
 if(authError||!user)return json({error:'UNAUTHORIZED'},401);
 const args:Record<string,string|null>={
  p_action:action,p_project:project,p_organization:organization,p_kind:kind,p_document:document,
 };
 if(action==='upload'){
  const length=Number(request.headers.get('content-length'));
  if(length>maxBytes+16384)return json({error:'INVALID_FILE'},413);
  const reader=request.body?.getReader();
  if(!reader)return json({error:'INVALID_FILE'},400);
  const parts:Buffer[]=[];
  let bytes=0;
  let file:FormDataEntryValue|null;
  let requirement:FormDataEntryValue|null;
  try{
   while(true){
    const next=await reader.read();
    if(next.done)break;
    bytes+=next.value.byteLength;
    if(bytes>maxBytes+16384){
     await reader.cancel();
     return json({error:'INVALID_FILE'},413);
    }
    parts.push(Buffer.from(next.value));
   }
   const form=await new Response(new Uint8Array(Buffer.concat(parts)),{headers:request.headers}).formData();
   file=form.get('file');
   requirement=form.get('requirement');
  }catch{return json({error:'INVALID_FILE'},400)}
  if(!file||typeof file==='string'||file.size<5||file.size>maxBytes||!mediaTypes.has(file.type)||
   !file.name.trim()||Array.from(file.name).length>160||/[\x00-\x1f\x7f/\\]/.test(file.name))
   return json({error:'INVALID_FILE'},400);
  if(requirement!==null){
   if(kind!=='licensing'||typeof requirement!=='string'||!requirement||requirement.length>100)
    return json({error:'INVALID_REQUIREMENT'},400);
   args.p_requirement=requirement;
  }
  args.p_filename=file.name;
  args.p_media_type=file.type;
  args.p_payload=Buffer.from(await file.arrayBuffer()).toString('base64');
 }
 const {data,error}=await supabase.rpc('feasibility_evidence',args);
 if(error){
  if(error.code==='42501')return json({error:'EVIDENCE_NOT_AVAILABLE'},404);
  if(error.message==='FEASIBILITY_EVIDENCE_INVALID_REQUIREMENT')return json({error:'INVALID_REQUIREMENT'},409);
  if(error.message==='FEASIBILITY_EVIDENCE_LIMIT')return json({error:'EVIDENCE_LIMIT'},409);
  if(['23514','23502','22023'].includes(error.code))return json({error:'INVALID_FILE'},400);
  return json({error:'EVIDENCE_REQUEST_FAILED'},500);
 }
 if(!data)return json({error:'DOCUMENT_NOT_FOUND'},404);
 if(action!=='download')return json(data,action==='upload'?201:200);
 const encodedName=encodeURIComponent(data.name).replace(/['()*]/g,char=>'%'+char.charCodeAt(0).toString(16));
 return new NextResponse(new Uint8Array(Buffer.from(data.base64,'base64')),{headers:{
  ...headers,'Content-Type':'application/octet-stream','X-Content-Type-Options':'nosniff',
  'Content-Disposition':"attachment; filename*=UTF-8''"+encodedName,
 }});
}
export const GET=handle;
export const POST=handle;
export const DELETE=handle;
