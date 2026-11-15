import {NextResponse} from 'next/server';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {supabaseServer} from '@/lib/supabase/server';
import {isSameOriginRequest} from '@/lib/request-origin';
export const dynamic='force-dynamic';
const enabled=()=>process.env.NEXT_PUBLIC_FEASIBILITY_STUDIES==='true'&&process.env.NEXT_PUBLIC_FEASIBILITY_CLOUD_QA==='true'&&process.env.NEXT_PUBLIC_FEASIBILITY_SHARING_QA==='true';
const json=(x:unknown,status=200)=>NextResponse.json(x,{status,headers:{'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'}});
const input=z.object({code:z.string().regex(/^[A-Za-z0-9_-]{40,60}$/)}).strict();
export async function POST(request:Request){
 if(!enabled())return json({error:'SHARING_DISABLED'},404);
 if(!isSameOriginRequest(request))return json({error:'INVALID_ORIGIN'},403);
 const supabase=await supabaseServer();
 const {data:{user},error}=await supabase.auth.getUser();
 if(error||!user)return json({error:'UNAUTHORIZED'},401);
 let body:unknown;try{const raw=await request.text();if(raw.length>1000)return json({error:'INVALID_INPUT'},400);body=JSON.parse(raw)}catch{return json({error:'INVALID_INPUT'},400)}
 const parsed=input.safeParse(body);if(!parsed.success)return json({error:'INVALID_INPUT'},400);
 const digest=createHash('sha256').update(parsed.data.code).digest('hex');
 const {data,error:rpcError}=await supabase.rpc('feasibility_accept_project_invitation',{p_token_digest:digest});
 // Never disclose whether an invitation or email exists.
 if(rpcError)return json({error:'INVALID_OR_EXPIRED_INVITATION'},403);
 return json(data);
}
