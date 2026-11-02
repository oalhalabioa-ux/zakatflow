import {NextResponse} from 'next/server';
import {requireUser} from '../../../../../services/auth';
import {requireOrganizationAdmin} from '../../../../../services/organization-access';
import {supabaseAdmin} from '../../../../../lib/supabase/server';
import {ADMIN_HEADER_ERROR,adminTransportFromResult,type AdminTransportFailure} from '../../../../../lib/supabase/admin-transport';
import {APP_ORIGIN} from '../../../../../lib/routing';
import {organizationInvitationEmail} from '../../../../../lib/email/organization-invitation';
import {invitationEmailConfigured,sendInvitationEmail} from '../../../../../services/email/resend';
import {invitationProof} from '../../../../../lib/auth/invitation-proof';
export async function POST(request:Request){
 let stage='input';
 let lookupFailure:{httpStatus:number|null;databaseCode:string;transportFailure?:AdminTransportFailure}|undefined;
 try{
  const {organization_id:organizationId,invitation_id:invitationId,locale:requested}=await request.json();
  const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  if(typeof organizationId!=='string'||typeof invitationId!=='string'||!uuid.test(organizationId)||!uuid.test(invitationId))return NextResponse.json({error:'INVITATION_DETAILS_INVALID'},{status:400});
  stage='authorization';
  const {supabase,user}=await requireUser();
  await requireOrganizationAdmin(supabase,user.id,organizationId);
  if(!invitationEmailConfigured())return NextResponse.json({error:'EMAIL_DELIVERY_UNAVAILABLE'},{status:503});
  // The token is intentionally not readable by authenticated clients. Read one
  // scoped record only after verifying the actor's active organization-admin role.
  stage='admin-client';
  const admin=await supabaseAdmin({diagnoseTransport:true});
  stage='invitation-lookup';
  const {data:invite,error,status:lookupStatus}=await admin.from('organization_invitations').select('id,organization_id,email,role,custom_role_id,token,expires_at,accepted_at').eq('id',invitationId).eq('organization_id',organizationId).maybeSingle();
  if(error){
   const allowedCodes=['42501','42703','42P01','PGRST106','PGRST116','PGRST204','PGRST205','PGRST301','PGRST302','PGRST303'];
   lookupFailure={httpStatus:Number.isInteger(lookupStatus)&&lookupStatus>=0&&lookupStatus<=599?lookupStatus:null,databaseCode:allowedCodes.includes(error.code)?error.code:'UNCLASSIFIED',...(lookupStatus===0?{transportFailure:adminTransportFromResult(error)}:{})};
   throw Error('INVITATION_LOOKUP_FAILED');
  }
  if(!invite||invite.accepted_at||new Date(invite.expires_at).getTime()<=Date.now())return NextResponse.json({error:'INVITATION_INVALID_OR_EXPIRED'},{status:409});
  stage='organization-lookup';
  const {data:organization,error:orgError}=await supabase.from('organizations').select('name').eq('id',organizationId).maybeSingle();
  if(orgError||!organization)throw Error('ORGANIZATION_ACCESS_REQUIRED');
  let customRoleName:string|null=null;
  if(invite.custom_role_id){const {data:role}=await supabase.from('organization_roles').select('name').eq('id',invite.custom_role_id).eq('organization_id',organizationId).maybeSingle();if(!role)throw Error('INVITATION_ROLE_INVALID');customRoleName=role.name;}
  const locale=requested==='en'?'en':'ar';
  const origin=process.env.NEXT_PUBLIC_APP_ENV==='test'?'http://127.0.0.1:3000':process.env.VERCEL_ENV==='preview'&&process.env.VERCEL_URL?`https://${process.env.VERCEL_URL}`:APP_ORIGIN;
  const url=new URL(`/${locale}/login/invitation`,origin);
  url.hash=new URLSearchParams({id:invite.id,proof:invitationProof(invite)}).toString();
  stage='render';
  const mail=organizationInvitationEmail({locale,organization:organization.name,email:invite.email,role:invite.role,customRoleName,expiresAt:invite.expires_at,inviteUrl:url.href});
  stage='transport';
  const receipt=await sendInvitationEmail({to:invite.email,...mail,invitationId});
  console.info('organization_invitation_email_accepted',{messageId:receipt.messageId});
  return NextResponse.json({status:'accepted'},{status:202,headers:{'Cache-Control':'private, no-store'}});
 }catch(error){
  const message=error instanceof Error?error.message:'';
  const unavailable=[ADMIN_HEADER_ERROR,'EMAIL_DELIVERY_UNAVAILABLE','SUPABASE_SERVICE_ROLE_KEY_NOT_CONFIGURED','SUPABASE_URL_NOT_CONFIGURED'].includes(message);
  const status=message==='UNAUTHORIZED'?401:/ADMIN_REQUIRED|ACCESS_REQUIRED/.test(message)?403:unavailable?503:message==='EMAIL_DELIVERY_FAILED'?502:stage==='input'?400:500;
  const safe=unavailable?'EMAIL_DELIVERY_UNAVAILABLE':['UNAUTHORIZED','ORGANIZATION_ADMIN_REQUIRED','ORGANIZATION_ACCESS_REQUIRED','INVITATION_ROLE_INVALID','EMAIL_DELIVERY_FAILED'].includes(message)?message:'INVITATION_EMAIL_FAILED';
  if(status>=500){
   // Never log raw exceptions, recipient addresses, invitation tokens or provider bodies.
   const known=[ADMIN_HEADER_ERROR,'SUPABASE_SERVICE_ROLE_KEY_NOT_CONFIGURED','SUPABASE_URL_NOT_CONFIGURED','INVITATION_LOOKUP_FAILED','EMAIL_DELIVERY_UNAVAILABLE','EMAIL_DELIVERY_FAILED','INVITATION_ROLE_INVALID'];
   console.error('organization_invitation_email_failed',{stage,code:known.includes(message)?message:'UNEXPECTED_FAILURE',...lookupFailure});
  }
  return NextResponse.json({error:safe},{status,headers:{'Cache-Control':'private, no-store'}});
 }
}

