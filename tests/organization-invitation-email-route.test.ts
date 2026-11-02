import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>({requireUser:vi.fn(),requireAdmin:vi.fn(),admin:vi.fn(),send:vi.fn(),configured:vi.fn(),query:vi.fn(),orgQuery:vi.fn()}));
vi.mock('../services/auth',()=>({requireUser:mocks.requireUser}));
vi.mock('../services/organization-access',()=>({requireOrganizationAdmin:mocks.requireAdmin}));
vi.mock('../lib/supabase/server',()=>({supabaseAdmin:mocks.admin}));
vi.mock('../services/email/resend',()=>({invitationEmailConfigured:mocks.configured,sendInvitationEmail:mocks.send}));
import {POST} from '../app/api/organizations/invitations/email/route';
const org='00000000-0000-0000-0000-000000000001',id='00000000-0000-0000-0000-000000000002';
const invite={id,organization_id:org,email:'actual@example.test',role:'VIEWER',token:'actual-token',expires_at:'2099-01-01',accepted_at:null};
const chain=(result:any)=>{const q:any={select:vi.fn(()=>q),eq:vi.fn(()=>q),maybeSingle:vi.fn(async()=>result)};return q};
const request=(extra={})=>new Request('https://attacker-host.test/api/organizations/invitations/email',{method:'POST',body:JSON.stringify({organization_id:org,invitation_id:id,locale:'en',...extra})});
beforeEach(()=>{vi.clearAllMocks();mocks.requireUser.mockResolvedValue({user:{id:'actor'},supabase:{from:()=>chain({data:{name:'Actual organization'}})}});mocks.requireAdmin.mockResolvedValue({role:'ADMIN',status:'ACTIVE'});mocks.configured.mockReturnValue(true);mocks.query.mockReturnValue(chain({data:invite,error:null}));mocks.admin.mockResolvedValue({from:mocks.query});mocks.send.mockResolvedValue({status:'accepted',messageId:'test-message'})});
afterEach(()=>vi.restoreAllMocks());
describe('authorized invitation delivery',()=>{
 it('reports invalid administrative headers before any lookup or email, without exposing the key',async()=>{const log=vi.spyOn(console,'error').mockImplementation(()=>{});mocks.admin.mockRejectedValue(Error('SUPABASE_SERVICE_ROLE_KEY_INVALID_HEADER'));const r=await POST(request());expect(r.status).toBe(503);expect(log).toHaveBeenCalledWith('organization_invitation_email_failed',{stage:'admin-client',code:'SUPABASE_SERVICE_ROLE_KEY_INVALID_HEADER'});expect(mocks.query).not.toHaveBeenCalled();expect(mocks.send).not.toHaveBeenCalled()});
 it('classifies an actual pre-response transport failure without treating it as invalid credentials',async()=>{const log=vi.spyOn(console,'error').mockImplementation(()=>{});mocks.query.mockReturnValue(chain({data:null,status:0,error:{code:'',message:'Error: SUPABASE_ADMIN_FETCH_DNS'}}));expect((await POST(request())).status).toBe(500);expect(log).toHaveBeenCalledWith('organization_invitation_email_failed',{stage:'invitation-lookup',code:'INVITATION_LOOKUP_FAILED',httpStatus:0,databaseCode:'UNCLASSIFIED',transportFailure:'DNS'});expect(mocks.send).not.toHaveBeenCalled()});
 it('retains only the provider receipt in acceptance logs and still does not claim delivery',async()=>{const log=vi.spyOn(console,'info').mockImplementation(()=>{});const r=await POST(request());expect(r.status).toBe(202);expect(log).toHaveBeenCalledWith('organization_invitation_email_accepted',{messageId:'test-message'});expect(JSON.stringify(log.mock.calls)).not.toContain(invite.email);expect(JSON.stringify(log.mock.calls)).not.toContain(invite.token);expect(await r.json()).toEqual({status:'accepted'})});

 it('rejects an unauthenticated caller before privileged lookup or sending',async()=>{mocks.requireUser.mockRejectedValue(Error('UNAUTHORIZED'));expect((await POST(request())).status).toBe(401);expect(mocks.admin).not.toHaveBeenCalled();expect(mocks.send).not.toHaveBeenCalled()});
 it('rejects ordinary members before privileged lookup',async()=>{mocks.requireAdmin.mockRejectedValue(Error('ORGANIZATION_ADMIN_REQUIRED'));expect((await POST(request())).status).toBe(403);expect(mocks.admin).not.toHaveBeenCalled()});
 it('checks both organization and invitation IDs and ignores attacker-supplied recipient/link/role',async()=>{const r=await POST(request({email:'attacker@example.test',invite_url:'https://evil.test',role:'OWNER'}));expect(r.status).toBe(202);expect(mocks.requireAdmin).toHaveBeenCalledWith(expect.anything(),'actor',org);const q=mocks.query.mock.results[0].value;expect(q.eq).toHaveBeenCalledWith('id',id);expect(q.eq).toHaveBeenCalledWith('organization_id',org);const sent=mocks.send.mock.calls[0][0];expect(sent.to).toBe('actual@example.test');expect(sent.html).toContain('https://app.yaqeenbiz.com/en/login?invite=actual-token');expect(sent.html).not.toContain('attacker-host');expect(await r.text()).not.toContain('actual-token')});
 it.each([{data:null},{data:{...invite,accepted_at:'2026-01-01'}},{data:{...invite,expires_at:'2020-01-01'}}])('rejects missing, accepted or expired invites without email',async result=>{mocks.query.mockReturnValue(chain(result));expect((await POST(request())).status).toBe(409);expect(mocks.send).not.toHaveBeenCalled()});
 it('does not claim delivery if transport is unconfigured or fails',async()=>{mocks.configured.mockReturnValue(false);expect((await POST(request())).status).toBe(503);mocks.configured.mockReturnValue(true);mocks.send.mockRejectedValue(Error('EMAIL_DELIVERY_FAILED'));expect((await POST(request())).status).toBe(502)});
 it('reports missing server credentials as unavailable, without sending or exposing configuration',async()=>{
  const log=vi.spyOn(console,'error').mockImplementation(()=>{});
  mocks.admin.mockRejectedValue(Error('SUPABASE_SERVICE_ROLE_KEY_NOT_CONFIGURED'));
  const response=await POST(request());
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({error:'EMAIL_DELIVERY_UNAVAILABLE'});
  expect(mocks.send).not.toHaveBeenCalled();
  expect(log).toHaveBeenCalledWith('organization_invitation_email_failed',{stage:'admin-client',code:'SUPABASE_SERVICE_ROLE_KEY_NOT_CONFIGURED'});
 });
 it('keeps lookup failures on the server and never logs recipient, token or raw exception',async()=>{
  const log=vi.spyOn(console,'error').mockImplementation(()=>{});
  mocks.query.mockReturnValue(chain({data:null,error:{message:'private database detail'}}));
  const response=await POST(request());
  expect(response.status).toBe(500);expect(await response.json()).toEqual({error:'INVITATION_EMAIL_FAILED'});
  expect(mocks.send).not.toHaveBeenCalled();
  expect(log).toHaveBeenCalledWith('organization_invitation_email_failed',{stage:'invitation-lookup',code:'INVITATION_LOOKUP_FAILED',httpStatus:null,databaseCode:'UNCLASSIFIED'});
  expect(JSON.stringify(log.mock.calls)).not.toMatch(/actual-token|actual@example|private database detail/);
 });
 it.each([401,403,404,0])('records safe lookup HTTP status %s without error bodies or arbitrary codes',async status=>{
  const log=vi.spyOn(console,'error').mockImplementation(()=>{});
  mocks.query.mockReturnValue(chain({data:null,status,error:{code:'secret-token',message:'private provider message'}}));
  expect((await POST(request())).status).toBe(500);
  expect(log).toHaveBeenCalledWith('organization_invitation_email_failed',{stage:'invitation-lookup',code:'INVITATION_LOOKUP_FAILED',httpStatus:status,databaseCode:'UNCLASSIFIED',...(status===0?{transportFailure:'UNKNOWN'}:{})});
  expect(JSON.stringify(log.mock.calls)).not.toMatch(/secret-token|private provider message/);
 });
 it('does not publish an arbitrary server exception',async()=>{
  const log=vi.spyOn(console,'error').mockImplementation(()=>{});
  mocks.admin.mockRejectedValue(Error('credential and token that must never be logged'));
  expect((await POST(request())).status).toBe(500);
  expect(log).toHaveBeenCalledWith('organization_invitation_email_failed',{stage:'admin-client',code:'UNEXPECTED_FAILURE'});
 });
 it.each(['ar','en'])('sends an existing saved invitation in %s without recreating or granting membership',async locale=>{
  const response=await POST(request({locale}));expect(response.status).toBe(202);
  expect(mocks.send.mock.calls[0][0].html).toContain(`/${locale}/login?invite=actual-token`);
  expect(mocks.query).toHaveBeenCalledExactlyOnceWith('organization_invitations');
 });
});
