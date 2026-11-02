import {NextResponse} from 'next/server';
import {supabaseAdmin,supabaseServer} from '../../../../../lib/supabase/server';
import {validInvitationProof} from '../../../../../lib/auth/invitation-proof';

function reply(body:object,status=200){return NextResponse.json(body,{status,headers:{'Cache-Control':'private, no-store'}});}
export async function POST(request:Request){
 try{
  if(!request.headers.get('content-type')?.startsWith('application/json'))return reply({error:'INVALID'},415);
  const origin=request.headers.get('origin');
  // Next may construct request.url with its internal hostname behind a proxy.
  // Compare the browser origin against the incoming public Host, not that internal URL.
  if(origin){
   const source=new URL(origin);
   if(!['http:','https:'].includes(source.protocol)||source.origin!==origin||source.host!==request.headers.get('host'))return reply({error:'INVALID'},403);
  }
  const {id,proof,action,password}=await request.json();
  if(typeof id!=='string'||!/^[0-9a-f-]{36}$/i.test(id)||typeof proof!=='string'||!/^[0-9a-f]{64}$/.test(proof))return reply({error:'INVALID'},400);
  const admin=await supabaseAdmin();
  const {data:invite,error}=await admin.from('organization_invitations').select('id,organization_id,email,token,expires_at,accepted_at').eq('id',id).maybeSingle();
  if(error)return reply({error:'UNAVAILABLE'},503);
  if(!invite||invite.accepted_at||new Date(invite.expires_at).getTime()<=Date.now()||!validInvitationProof(invite,proof))return reply({error:'INVALID'},410);
  if(action==='inspect')return reply({email:invite.email});
  if(!['activate','signin'].includes(action)||typeof password!=='string'||!password||password.length>128)return reply({error:'PASSWORD'},400);
  if(action==='activate'){
   if(password.length<12||!/[0-9]/.test(password)||!/\p{L}/u.test(password))return reply({error:'PASSWORD'},400);
   // Create only. A duplicate identity must authenticate with its existing password.
   const {error:creation}=await admin.auth.admin.createUser({email:invite.email,password,email_confirm:true});
   if(creation)return ['email_exists','user_already_exists'].includes(creation.code??'')?reply({error:'EXISTING'},409):reply({error:'UNAVAILABLE'},503);
  }
  const client=await supabaseServer();
  const {data,error:login}=await client.auth.signInWithPassword({email:invite.email,password});
  if(login||data.user?.email?.toLowerCase()!==invite.email.toLowerCase())return reply({error:'LOGIN'},401);
  const {error:accept}=await client.rpc('accept_organization_invitation',{p_token:invite.token});
  if(accept){await client.auth.signOut({scope:'local'});return reply({error:action==='activate'?'CREATED_JOIN_FAILED':'ACCEPT'},409);}
  return reply({organization:invite.organization_id});
 }catch{return reply({error:'UNAVAILABLE'},503);}
}
