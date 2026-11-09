import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {createHash} from 'node:crypto';
const mocks=vi.hoisted(()=>({supabaseServer:vi.fn(),isSameOriginRequest:vi.fn()}));
vi.mock('@/lib/supabase/server',()=>({supabaseServer:mocks.supabaseServer}));
vi.mock('@/lib/request-origin',()=>({isSameOriginRequest:mocks.isSameOriginRequest}));
import {GET as list,POST as invite} from '../../app/api/feasibility/invitations/route';
import {POST as accept} from '../../app/api/feasibility/invitations/accept/route';
const owner='6357a708-bae2-4634-9296-490404b1d8a4';
const projectId='09d4c3bb-c5ee-4ac5-9b64-8127a2e55b98';
const original={studies:process.env.NEXT_PUBLIC_FEASIBILITY_STUDIES,cloud:process.env.NEXT_PUBLIC_FEASIBILITY_CLOUD_QA,sharing:process.env.NEXT_PUBLIC_FEASIBILITY_SHARING_QA};
function request(path:string,data:unknown){return new Request('https://qa.local'+path,{method:'POST',
 headers:{Origin:'https://qa.local','content-type':'application/json'},body:JSON.stringify(data)});}
function mockData(){
 const access={select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),
  maybeSingle:vi.fn().mockResolvedValue({data:{status:'ACTIVE',starts_at:'2026-11-01T00:00:00Z',ends_at:null},error:null})};
 const project={select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),
  maybeSingle:vi.fn().mockResolvedValue({data:{id:projectId},error:null})};
 const invites={select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),order:vi.fn().mockReturnThis(),
  limit:vi.fn().mockResolvedValue({data:[],error:null}),insert:vi.fn().mockReturnThis(),
  single:vi.fn().mockResolvedValue({data:{id:'sent',role:'VIEWER',expires_at:'2026-11-15T00:00:00Z'},error:null})};
 const members={select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),
  limit:vi.fn().mockResolvedValue({data:[],error:null})};
 const from=vi.fn((name:string)=>name==='feasibility_access_grants'?access:
  name==='feasibility_projects'?project:name==='feasibility_project_invitations'?invites:members);
 const rpc=vi.fn().mockResolvedValue({data:{project_id:projectId,role:'VIEWER',status:'ACCEPTED'},error:null});
 const getUser=vi.fn().mockResolvedValue({data:{user:{id:owner}},error:null});
 mocks.supabaseServer.mockResolvedValue({from,rpc,auth:{getUser}});
 return {access,project,invites,members,from,rpc,getUser};
}
beforeEach(()=>{
 vi.resetAllMocks();mocks.isSameOriginRequest.mockReturnValue(true);
 process.env.NEXT_PUBLIC_FEASIBILITY_STUDIES='true';
 process.env.NEXT_PUBLIC_FEASIBILITY_CLOUD_QA='true';
 process.env.NEXT_PUBLIC_FEASIBILITY_SHARING_QA='true';
});
afterEach(()=>{
 for(const [key,value] of [
  ['NEXT_PUBLIC_FEASIBILITY_STUDIES',original.studies],
  ['NEXT_PUBLIC_FEASIBILITY_CLOUD_QA',original.cloud],
  ['NEXT_PUBLIC_FEASIBILITY_SHARING_QA',original.sharing]
 ] as const){if(value===undefined)delete process.env[key];else process.env[key]=value;}
});
describe('QA V2 email-bound invitation boundary',()=>{
 it('is disabled by default and makes no authenticated calls',async()=>{
  process.env.NEXT_PUBLIC_FEASIBILITY_SHARING_QA='false';
  expect((await list(new Request('https://qa.local/api/feasibility/invitations?project_id='+projectId))).status).toBe(404);
  expect((await invite(request('/api/feasibility/invitations',{projectId,email:'person@example.com',role:'VIEWER'}))).status).toBe(404);
  expect(mocks.supabaseServer).not.toHaveBeenCalled();
 });
 it('rejects cross-origin creation and redemption before authentication',async()=>{
  mocks.isSameOriginRequest.mockReturnValue(false);
  expect((await invite(request('/api/feasibility/invitations',{projectId,email:'person@example.com',role:'VIEWER'}))).status).toBe(403);
  expect((await accept(request('/api/feasibility/invitations/accept',{code:'a'.repeat(43)}))).status).toBe(403);
  expect(mocks.supabaseServer).not.toHaveBeenCalled();
 });
 it('never permits a user to self-assign an editor role through an invite',async()=>{
  const {invites}=mockData();
  expect((await invite(request('/api/feasibility/invitations',{projectId,email:'person@example.com',role:'EDITOR'}))).status).toBe(400);
  expect(invites.insert).not.toHaveBeenCalled();
 });
 it('requires ownership to issue one-time codes',async()=>{
  const {project,invites}=mockData();
  project.maybeSingle.mockResolvedValueOnce({data:null,error:null});
  expect((await invite(request('/api/feasibility/invitations',{projectId,email:'person@example.com',role:'VIEWER'}))).status).toBe(403);
  expect(invites.insert).not.toHaveBeenCalled();
 });
 it('sends raw invitation code once and stores only its 256-bit hash',async()=>{
  const {invites}=mockData();
  const res=await invite(request('/api/feasibility/invitations',{projectId,email:'PERSON@example.com',role:'VIEWER'}));
  expect(res.status).toBe(201);
  const saved=invites.insert.mock.calls[0][0],body=await res.json();
  expect(saved.invitee_email).toBe('person@example.com');
  expect(saved.role).toBe('VIEWER');
  expect(saved.token_digest).toBe(createHash('sha256').update(body.code).digest('hex'));
  expect(saved.token_digest).not.toBe(body.code);
  expect(body.code).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
 });
 it('requires a real authenticated user for accepting a code',async()=>{
  const {getUser,rpc}=mockData();
  getUser.mockResolvedValueOnce({data:{user:null},error:null});
  expect((await accept(request('/api/feasibility/invitations/accept',{code:'a'.repeat(43)}))).status).toBe(401);
  expect(rpc).not.toHaveBeenCalled();
 });
 it('hashes code and lets the database verify the recipient email and expiry',async()=>{
  const {rpc}=mockData();const code='c'.repeat(43);
  expect((await accept(request('/api/feasibility/invitations/accept',{code}))).status).toBe(200);
  expect(rpc).toHaveBeenCalledWith('feasibility_accept_project_invitation',{
   p_token_digest:createHash('sha256').update(code).digest('hex')
  });
  rpc.mockResolvedValueOnce({data:null,error:{message:'recipient mismatch'}});
  expect((await accept(request('/api/feasibility/invitations/accept',{code}))).status).toBe(403);
 });
 it('lists only the current owner invitations without exposing raw tokens',async()=>{
  const {invites}=mockData();
  const res=await list(new Request('https://qa.local/api/feasibility/invitations?project_id='+projectId));
  expect(res.status).toBe(200);
  expect(invites.select.mock.calls[0][0]).not.toContain('token_digest');
 });
});
