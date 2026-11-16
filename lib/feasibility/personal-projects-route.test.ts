import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {createStudy} from './engine';

const mocks=vi.hoisted(()=>({server:vi.fn(),sameOrigin:vi.fn()}));
vi.mock('@/lib/supabase/server',()=>({supabaseServer:mocks.server}));
vi.mock('@/lib/request-origin',()=>({isSameOriginRequest:mocks.sameOrigin}));
import {GET,PATCH,POST,DELETE} from '../../app/api/feasibility/projects/route';

const userId='d7ed1c47-cc70-4cbd-aef4-8031df4f990a';
const study=createStudy('3467a6e8-368a-46d1-979d-d0b8448d593f','QA personal water');
const savedEnv={
 feasibility:process.env.NEXT_PUBLIC_FEASIBILITY_STUDIES,
 cloud:process.env.NEXT_PUBLIC_FEASIBILITY_CLOUD_QA,
 org:process.env.FEASIBILITY_ORG_QA
};
function mockDb(){
 const grants={select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),
  maybeSingle:vi.fn().mockResolvedValue({data:{status:'ACTIVE',starts_at:'2026-11-01T00:00:00Z',ends_at:null},error:null})};
 const projects={select:vi.fn().mockReturnThis(),is:vi.fn().mockReturnThis(),
  eq:vi.fn().mockReturnThis(),order:vi.fn().mockReturnThis(),
  limit:vi.fn().mockResolvedValue({data:[],error:null}),
  update:vi.fn().mockReturnThis(),delete:vi.fn().mockReturnThis(),
  insert:vi.fn().mockReturnThis(),single:vi.fn().mockResolvedValue({data:{revision:1},error:null}),
  maybeSingle:vi.fn().mockResolvedValue({data:{revision:2,id:study.id},error:null})
 };
 const from=vi.fn((name:string)=>name==='feasibility_access_grants'?grants:projects);
 mocks.server.mockResolvedValue({auth:{getUser:vi.fn().mockResolvedValue({data:{user:{id:userId}},error:null})},from});
 return {grants,projects,from};
}
function request(method:'POST'|'PATCH'|'DELETE',body?:unknown){
 return new Request('https://qa.local/api/feasibility/projects'+(method==='DELETE'?'?id='+study.id:''),{
  method,headers:{Origin:'https://qa.local','content-type':'application/json'},
  ...(body===undefined?{}:{body:JSON.stringify(body)})
 });
}
beforeEach(()=>{
 vi.resetAllMocks();mocks.sameOrigin.mockReturnValue(true);
 process.env.NEXT_PUBLIC_FEASIBILITY_STUDIES='true';
 process.env.NEXT_PUBLIC_FEASIBILITY_CLOUD_QA='true';
 process.env.FEASIBILITY_ORG_QA='true';
});
afterEach(()=>{
 for(const [key,v] of [
  ['NEXT_PUBLIC_FEASIBILITY_STUDIES',savedEnv.feasibility],
  ['NEXT_PUBLIC_FEASIBILITY_CLOUD_QA',savedEnv.cloud],
  ['FEASIBILITY_ORG_QA',savedEnv.org]
 ] as const){if(v===undefined)delete process.env[key];else process.env[key]=v;}
});
describe('legacy personal cloud drafts stay outside corporate tenant scope',()=>{
 it('reads only personal rows after the institutional schema gate',async()=>{
  const {projects}=mockDb();
  expect((await GET()).status).toBe(200);
  expect(projects.is).toHaveBeenCalledWith('organization_id',null);
 });
 it('preserves backwards-compatible queries before institutional migration',async()=>{
  const {projects}=mockDb();process.env.FEASIBILITY_ORG_QA='false';
  expect((await GET()).status).toBe(200);
  expect(projects.is).not.toHaveBeenCalled();
 });
 it('guards personal PATCH with both creator ownership and null institution',async()=>{
  const {projects}=mockDb();
  expect((await PATCH(request('PATCH',{study,revision:1}))).status).toBe(200);
  expect(projects.eq).toHaveBeenCalledWith('owner_user_id',userId);
  expect(projects.eq).toHaveBeenCalledWith('revision',1);
  expect(projects.is).toHaveBeenCalledWith('organization_id',null);
 });
 it('guards personal DELETE by original owner and null institution',async()=>{
  const {projects}=mockDb();
  expect((await DELETE(request('DELETE'))).status).toBe(200);
  expect(projects.eq).toHaveBeenCalledWith('owner_user_id',userId);
  expect(projects.is).toHaveBeenCalledWith('organization_id',null);
 });
 it('never accepts a user-supplied organization principal in the personal POST payload',async()=>{
  const {projects}=mockDb();
  const payload={study,organization_id:'fcbfae0b-c037-4ed0-ad82-d8101cf1fa34'};
  expect((await POST(request('POST',payload))).status).toBe(400);
  expect(projects.insert).not.toHaveBeenCalled();
 });
 it('assigns personal owner from authenticated identity',async()=>{
  const {projects}=mockDb();
  expect((await POST(request('POST',{study}))).status).toBe(201);
  expect(projects.insert).toHaveBeenCalledWith(expect.objectContaining({
   id:study.id,owner_user_id:userId
  }));
 });
});
