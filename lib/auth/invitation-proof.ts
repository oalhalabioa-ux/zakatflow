import {createHmac,timingSafeEqual} from 'node:crypto';

type Binding={id:string;organization_id:string;email:string;token:string;expires_at:string};
export function invitationProof(invite:Binding){
  const secret=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!secret)throw Error('INVITATION_SIGNING_UNAVAILABLE');
  return createHmac('sha256',secret).update(JSON.stringify(['organization-mail:v1',invite.id,invite.organization_id,invite.email,invite.token,invite.expires_at])).digest('hex');
}
export function validInvitationProof(invite:Binding,proof:unknown){
  return typeof proof==='string'&&/^[0-9a-f]{64}$/.test(proof)&&timingSafeEqual(Buffer.from(invitationProof(invite),'hex'),Buffer.from(proof,'hex'));
}
