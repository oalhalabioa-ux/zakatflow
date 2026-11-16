import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {emailInvitationsReady,sendFeasibilityInvitationEmail} from './email-invitations';

const input={
 to:'recipient@example.org',
 code:'f'.repeat(43),
 role:'VIEWER' as const,
 locale:'ar' as const,
 invitationId:'c6065531-85c4-4e3b-846c-dbb4c1e10cc3',
 expiresAt:'2026-11-21T10:00:00Z'
};
const keys=['FEASIBILITY_INVITATION_EMAIL_QA','RESEND_API_KEY',
 'FEASIBILITY_INVITE_FROM_EMAIL','FEASIBILITY_INVITE_PUBLIC_ORIGIN'] as const;
const original=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
beforeEach(()=>{
 vi.stubGlobal('fetch',vi.fn());
 process.env.FEASIBILITY_INVITATION_EMAIL_QA='true';
 process.env.RESEND_API_KEY='re_testing_only';
 process.env.FEASIBILITY_INVITE_FROM_EMAIL='Yaqeen <invites@example.org>';
 process.env.FEASIBILITY_INVITE_PUBLIC_ORIGIN='https://qa.example.org';
});
afterEach(()=>{
 vi.unstubAllGlobals();
 for(const k of keys){const v=original[k];if(v===undefined)delete process.env[k];else process.env[k]=v}
});

describe('QA-only invitation email delivery adapter',()=>{
 it('is disabled unless server-side flag and verified sender settings exist',()=>{
  process.env.FEASIBILITY_INVITATION_EMAIL_QA='false';
  expect(emailInvitationsReady()).toBe(false);
  process.env.FEASIBILITY_INVITATION_EMAIL_QA='true';
  delete process.env.RESEND_API_KEY;
  expect(emailInvitationsReady()).toBe(false);
 });
 it('rejects non-HTTPS or credentialed application origins',()=>{
  for(const origin of ['http://qa.example.org','https://user:password@qa.example.org',
   'https://qa.example.org/path','https://qa.example.org?token=x',
   'https://localhost']){
   process.env.FEASIBILITY_INVITE_PUBLIC_ORIGIN=origin;
   expect(emailInvitationsReady()).toBe(false);
  }
 });
 it('submits one provider-acknowledged invitation using a unique idempotency key',async()=>{
  const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify({id:'provider-message'}),{
   status:200,headers:{'content-type':'application/json'}
  }));
  vi.stubGlobal('fetch',fetch);
  const providerId=await sendFeasibilityInvitationEmail(input);
  expect(providerId).toBe('provider-message');
  expect(fetch).toHaveBeenCalledTimes(1);
  const [url,request]=fetch.mock.calls[0] as [string,RequestInit];
  expect(url).toBe('https://api.resend.com/emails');
  expect(request.method).toBe('POST');
  expect((request.headers as Record<string,string>)['Idempotency-Key'])
   .toBe('feasibility-invitation-'+input.invitationId);
  const body=JSON.parse(request.body as string);
  expect(body.from).toBe('Yaqeen <invites@example.org>');
  expect(body.to).toEqual(['recipient@example.org']);
  expect(body.text).toContain(input.code);
  expect(body.text).toContain('https://qa.example.org/ar/feasibility');
 });
 it('fails closed on provider rejection and malformed response without claiming delivery',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('{}',{status:503})));
  await expect(sendFeasibilityInvitationEmail(input)).rejects.toThrow('EMAIL_PROVIDER_REJECTED');
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('{}',{status:200})));
  await expect(sendFeasibilityInvitationEmail(input)).rejects.toThrow('EMAIL_PROVIDER_NO_ACK');
 });
 it('rejects any malformed token or invitation identity before making an external request',async()=>{
  const fetch=vi.fn();
  vi.stubGlobal('fetch',fetch);
  await expect(sendFeasibilityInvitationEmail({...input,code:'wrong'})).rejects.toThrow('EMAIL_INVITATION_NOT_READY');
  await expect(sendFeasibilityInvitationEmail({...input,invitationId:'not-id'})).rejects.toThrow('EMAIL_INVITATION_NOT_READY');
  expect(fetch).not.toHaveBeenCalled();
 });
});
