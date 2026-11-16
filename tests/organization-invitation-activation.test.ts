import {afterEach, beforeEach, expect, it, vi} from 'vitest';
const mocks=vi.hoisted(()=>({admin:vi.fn(),server:vi.fn(),create:vi.fn(),signin:vi.fn(),accept:vi.fn(),signout:vi.fn()}));
vi.mock('../lib/supabase/server',()=>({supabaseAdmin:mocks.admin,supabaseServer:mocks.server}));
import {POST} from '../app/api/organizations/invitations/activate/route';
import {invitationProof} from '../lib/auth/invitation-proof';
const invite={id:'00000000-0000-0000-0000-000000000002',organization_id:'00000000-0000-0000-0000-000000000001',email:'invited@example.test',token:'private-token',expires_at:'2099-01-01',accepted_at:null};
let record:any;
function request(extra={},origin='https://app.yaqeenbiz.com'){
 return new Request('http://internal-next:3000/api/organizations/invitations/activate',{method:'POST',headers:{'Content-Type':'application/json',Host:'app.yaqeenbiz.com',Origin:origin},body:JSON.stringify({id:invite.id,proof:invitationProof(invite),action:'inspect',...extra})});
}
beforeEach(()=>{
 vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY','isolated-test-secret');vi.clearAllMocks();record={...invite};
 const q:any={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:record,error:null})};
 mocks.admin.mockResolvedValue({from:()=>q,auth:{admin:{createUser:mocks.create}}});
 mocks.server.mockResolvedValue({auth:{signInWithPassword:mocks.signin,signOut:mocks.signout},rpc:mocks.accept});
 mocks.create.mockResolvedValue({error:null});mocks.signin.mockResolvedValue({data:{user:{email:invite.email}},error:null});mocks.accept.mockResolvedValue({error:null});
});
afterEach(()=>vi.unstubAllEnvs());
it('accepts the public same-origin request behind an internal Next hostname',async()=>{const r=await POST(request());expect(r.status).toBe(200);expect(await r.json()).toEqual({email:invite.email});expect(r.headers.get('Cache-Control')).toContain('no-store')});
it('rejects cross-origin requests before privileged lookup',async()=>{expect((await POST(request({},'https://other.test'))).status).toBe(403);expect(mocks.admin).not.toHaveBeenCalled()});
it.each(['proof','email','token','organization_id'])('rejects tampering with %s before account creation',async field=>{const extra=field==='proof'?{proof:'0'.repeat(64)}:{};if(field!=='proof')record[field]='changed';expect((await POST(request(extra))).status).toBe(410);expect(mocks.create).not.toHaveBeenCalled()});
it.each(['accepted','expired'])('rejects an %s invitation',async state=>{if(state==='accepted')record.accepted_at='2026-01-01';else record.expires_at='2000-01-01';expect((await POST(request())).status).toBe(410)});
it('creates only the email bound to the signed invitation',async()=>{const r=await POST(request({action:'activate',password:'ChosenPassword123!',email:'other@example.test'}));expect(r.status).toBe(200);expect(mocks.create).toHaveBeenCalledWith({email:invite.email,password:'ChosenPassword123!',email_confirm:true});expect(mocks.accept).toHaveBeenCalledWith('accept_organization_invitation',{p_token:invite.token})});
it('never signs in or changes a duplicate account password',async()=>{mocks.create.mockResolvedValue({error:{code:'email_exists'}});expect((await POST(request({action:'activate',password:'ChosenPassword123!'}))).status).toBe(409);expect(mocks.signin).not.toHaveBeenCalled();expect(mocks.accept).not.toHaveBeenCalled()});
it('requires the existing password before accepting membership',async()=>{mocks.signin.mockResolvedValue({data:{user:null},error:{message:'Invalid password'}});expect((await POST(request({action:'signin',password:'wrong'}))).status).toBe(401);expect(mocks.create).not.toHaveBeenCalled();expect(mocks.accept).not.toHaveBeenCalled()});
it('closes the session and reports partial creation when membership fails',async()=>{mocks.accept.mockResolvedValue({error:{message:'seat limit'}});const r=await POST(request({action:'activate',password:'ChosenPassword123!'}));expect(r.status).toBe(409);expect(await r.json()).toEqual({error:'CREATED_JOIN_FAILED'});expect(mocks.signout).toHaveBeenCalledWith({scope:'local'})});
