import {NextResponse} from 'next/server';
import {requireUser} from '../../../../../services/auth';
import {requireOrganizationAdmin} from '../../../../../services/organization-access';
import {supabaseAdmin} from '../../../../../lib/supabase/server';
import {APP_ORIGIN} from '../../../../../lib/routing';
import {organizationInvitationEmail} from '../../../../../lib/email/organization-invitation';
import {invitationEmailConfigured,sendInvitationEmail} from '../../../../../services/email/resend';
export async function POST(request:Request){
 try{
  const {organization_id:organizationId,invitation_id:invitationId,locale:requested}=await request.json();
  const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  if(typeof organizationId!=='string'||typeof invitationId!=='string'||!uuid.test(organizationId)||!uuid.test(invitationId))return NextResponse.json({error:'INVITATION_DETAILS_INVALID'},{status:400});
  const {supabase,user}=await requireUser();
  await requireOrganizationAdmin(supabase,user.id,organizationId);
  if(!invitationEmailConfigured())return NextResponse.json({error:'EMAIL_DELIVERY_UNAVAILABLE'},{status:503});
  // The token is intentionally not readable by authenticated clients. Read one
  // scoped record only after verifying the actor's active organization-admin role.
  const admin=await supabaseAdmin();
  const {data:invite,error}=await admin.from('organization_invitations').select('id,organization_id,email,role,custom_role_id,token,expires_at,accepted_at').eq('id',invitationId).eq('organization_id',organizationId).maybeSingle();
  if(error)throw Error('INVITATION_LOOKUP_FAILED');
  if(!invite||invite.accepted_at||new Date(invite.expires_at).getTime()<=Date.now())return NextResponse.json({error:'INVITATION_INVALID_OR_EXPIRED'},{status:409});
  const {data:organization,error:orgError}=await supabase.from('organizations').select('name').eq('id',organizationId).maybeSingle();
  if(orgError||!organization)throw Error('ORGANIZATION_ACCESS_REQUIRED');
  let customRoleName:string|null=null;
  if(invite.custom_role_id){const {data:role}=await supabase.from('organization_roles').select('name').eq('id',invite.custom_role_id).eq('organization_id',organizationId).maybeSingle();if(!role)throw Error('INVITATION_ROLE_INVALID');customRoleName=role.name;}
  const locale=requested==='en'?'en':'ar';
  const origin=process.env.NEXT_PUBLIC_APP_ENV==='test'?'http://127.0.0.1:3000':process.env.VERCEL_ENV==='preview'&&process.env.VERCEL_URL?`https://${process.env.VERCEL_URL}`:APP_ORIGIN;
  const url=new URL(`/${locale}/login`,origin);url.searchParams.set('invite',invite.token);
  const mail=organizationInvitationEmail({locale,organization:organization.name,email:invite.email,role:invite.role,customRoleName,expiresAt:invite.expires_at,inviteUrl:url.href});
  await sendInvitationEmail({to:invite.email,...mail,invitationId});
  return NextResponse.json({status:'accepted'},{status:202,headers:{'Cache-Control':'private, no-store'}});
 }catch(error){
  const message=error instanceof Error?error.message:'';
  const status=message==='UNAUTHORIZED'?401:/ADMIN_REQUIRED|ACCESS_REQUIRED/.test(message)?403:message==='EMAIL_DELIVERY_UNAVAILABLE'?503:message==='EMAIL_DELIVERY_FAILED'?502:400;
  const safe=['UNAUTHORIZED','ORGANIZATION_ADMIN_REQUIRED','ORGANIZATION_ACCESS_REQUIRED','INVITATION_ROLE_INVALID','EMAIL_DELIVERY_FAILED','EMAIL_DELIVERY_UNAVAILABLE'].includes(message)?message:'INVITATION_EMAIL_FAILED';
  return NextResponse.json({error:safe},{status});
 }
}
