import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {createStudy} from './engine';
const mocks=vi.hoisted(()=>({supabaseServer:vi.fn(),sameOrigin:vi.fn()}));
vi.mock('@/lib/supabase/server',()=>({supabaseServer:mocks.supabaseServer}));
vi.mock('@/lib/request-origin',()=>({isSameOriginRequest:mocks.sameOrigin}));
import {GET,POST,PATCH} from '../../app/api/feasibility/organization-projects/route';

const userId='b3719dce-80e9-4f89-9ed2-f42a191eef02';
const orgId='b67fa2de-0da1-4bd7-b2af-35e72a0732fd';
const otherOrg='9a488471-6f07-44c0-8c6b-69a298bd4eab';
const study=createStudy('027d530c-813d-4915-8891-e081865b8867','Water factory');
const sharingFlag=process.env.FEASIBILITY_ORG_SHARING;
const vars=['FEASIBILITY_ORG_QA','NEXT_PUBLIC_FEASIBILITY_STUDIES','NEXT_PUBLIC_FEASIBILITY_CLOUD_QA'] as const;
const backup=Object.fromEntries(vars.map(key=>[key,process.env[key]]));
function req(org=orgId,method='GET',body?:unknown){
 return new Request('https://qa.local/api/feasibility/organization-projects?organization='+org,{
  method,headers:{Origin:'https://qa.local','content-type':'application/json'},
  ...(body===undefined?{}:{body:JSON.stringify(body)})
 });
}
function mockDb(role='OWNER',status='ACTIVE'){
 const grant={select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),
  maybeSingle:vi.fn().mockResolvedValue({data:{status:'ACTIVE',starts_at:'2026-11-01T00:00:00Z',ends_at:null},error:null})};
 const membership={select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),
  maybeSingle:vi.fn().mockResolvedValue({data:{role,status},error:null})};
 const org={select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),
  maybeSingle:vi.fn().mockResolvedValue({data:{id:orgId,status:'ACTIVE',name:'QA Organization'},error:null})};
 const projects={select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),is:vi.fn().mockReturnThis(),
  order:vi.fn().mockReturnThis(),limit:vi.fn().mockResolvedValue({data:[],error:null}),
  insert:vi.fn().mockReturnThis(),single:vi.fn().mockResolvedValue({data:{revision:1},error:null}),
  update:vi.fn().mockReturnThis(),maybeSingle:vi.fn().mockResolvedValue({data:{revision:2},error:null})};
 const from=vi.fn((name:string)=>name==='feasibility_access_grants'?grant:
  name==='organization_members'?membership:name==='organizations'?org:projects);
 const getUser=vi.fn().mockResolvedValue({data:{user:{id:userId}},error:null});
 const rpc=vi.fn().mockResolvedValue({data:{canRead:true,canWrite:true,canShare:false},error:null});
 mocks.supabaseServer.mockResolvedValue({auth:{getUser},from,rpc});
 return {grant,membership,org,projects,from,getUser,rpc};
}
beforeEach(()=>{
 vi.resetAllMocks();mocks.sameOrigin.mockReturnValue(true);
 for(const k of vars)process.env[k]='true';
 delete process.env.FEASIBILITY_ORG_SHARING;
});
afterEach(()=>{
 if(sharingFlag===undefined)delete process.env.FEASIBILITY_ORG_SHARING;
 else process.env.FEASIBILITY_ORG_SHARING=sharingFlag;
 for(const k of vars){const v=backup[k];if(v===undefined)delete process.env[k];else process.env[k]=v;}});

describe('institutional feasibility portfolio server gate',()=>{
 it('is disabled by default and never queries a database',async()=>{
  process.env.FEASIBILITY_ORG_QA='false';
  expect((await GET(req())).status).toBe(404);
  expect(mocks.supabaseServer).not.toHaveBeenCalled();
 });
 it('rejects missing or malformed institution IDs before authentication',async()=>{
  expect((await GET(req('bad-id'))).status).toBe(400);
  expect(mocks.supabaseServer).not.toHaveBeenCalled();
 });
 it('requires authenticated user and valid feasibility entitlement',async()=>{
  const db=mockDb();
  db.getUser.mockResolvedValueOnce({data:{user:null},error:null});
  expect((await GET(req())).status).toBe(401);
  db.grant.maybeSingle.mockResolvedValueOnce({data:null,error:null});
  expect((await GET(req())).status).toBe(403);
  expect(db.projects.select).not.toHaveBeenCalled();
 });
 it('requires active membership and an active organization',async()=>{
  const db=mockDb();
  db.membership.maybeSingle.mockResolvedValueOnce({data:null,error:null});
  expect((await GET(req(otherOrg))).status).toBe(404);
  db.membership.maybeSingle.mockResolvedValueOnce({data:{role:'OWNER',status:'SUSPENDED'},error:null});
  expect((await GET(req())).status).toBe(404);
  db.org.maybeSingle.mockResolvedValueOnce({data:{id:orgId,status:'INACTIVE'},error:null});
  expect((await GET(req())).status).toBe(404);
  expect(db.projects.select).not.toHaveBeenCalled();
 });
 it('filters every institutional read by its specific organization',async()=>{
  const db=mockDb('VIEWER');
  expect((await GET(req(orgId))).status).toBe(200);
  expect(db.projects.eq).toHaveBeenCalledWith('organization_id',orgId);
  expect(db.projects.limit).toHaveBeenCalledWith(300);
 });
 it('reports trustworthy write capability without requiring callers to infer the role',async()=>{
  mockDb('VIEWER');
  const view=await (await GET(req())).json();
  expect(view).toEqual({studies:[],canWrite:false});
  mockDb('ADMIN');
  const admin=await (await GET(req())).json();
  expect(admin).toEqual({studies:[],canWrite:true});
 });
 it('keeps compatibility reads while denying creation, updates and copying without a company write entitlement',async()=>{
  const db=mockDb('OWNER');
  db.rpc.mockResolvedValue({data:{canRead:false,canWrite:false,canShare:true},error:null});
  const response=await GET(req());
  expect(await response.json()).toEqual({studies:[],canWrite:false});
  expect(db.rpc).toHaveBeenCalledWith('feasibility_company_workspace',{p_organization:orgId});
  expect((await POST(req(orgId,'POST',{study}))).status).toBe(403);
  expect((await PATCH(req(orgId,'PATCH',{study,revision:1}))).status).toBe(403);
  expect((await GET(req(orgId+'&action=copy'))).status).toBe(403);
  expect((await POST(req(orgId+'&action=copy','POST',{sourceId:study.id,revision:1,confirmed:true}))).status).toBe(403);
  expect(db.projects.insert).not.toHaveBeenCalled();
  expect(db.projects.update).not.toHaveBeenCalled();
 });

 it('fails closed on company entitlement errors without removing existing read access',async()=>{
  const db=mockDb('ADMIN');
  db.rpc.mockResolvedValue({data:null,error:{code:'PGRST202'}});
  expect(await (await GET(req())).json()).toEqual({studies:[],canWrite:false});
  expect((await POST(req(orgId,'POST',{study}))).status).toBe(403);
  expect(db.projects.insert).not.toHaveBeenCalled();
 });

 it('prohibits non-admin writes even with a paid member grant',async()=>{
  const db=mockDb('VIEWER');
  expect((await POST(req(orgId,'POST',{study}))).status).toBe(403);
  expect(db.projects.insert).not.toHaveBeenCalled();
 });
 it('enforces same-origin before writing',async()=>{
  mocks.sameOrigin.mockReturnValue(false);
  expect((await POST(req(orgId,'POST',{study}))).status).toBe(403);
  expect(mocks.supabaseServer).not.toHaveBeenCalled();
 });
 it('creates new project only for a licensed authorized org owner',async()=>{
  const db=mockDb('OWNER');
  expect((await POST(req(orgId,'POST',{study}))).status).toBe(201);
  expect(db.projects.insert).toHaveBeenCalledWith(expect.objectContaining({
   id:study.id,organization_id:orgId,owner_user_id:null,
   created_by_user_id:userId,title:study.title
  }));
 });
 it('guards every update by organization and revision',async()=>{
  const db=mockDb('ADMIN');
  expect((await PATCH(req(orgId,'PATCH',{study,revision:5}))).status).toBe(200);
  expect(db.projects.eq).toHaveBeenCalledWith('organization_id',orgId);
  expect(db.projects.eq).toHaveBeenCalledWith('revision',5);
  db.projects.maybeSingle.mockResolvedValueOnce({data:null,error:null});
  expect((await PATCH(req(orgId,'PATCH',{study,revision:5}))).status).toBe(409);
 });
});

describe('copy a personal cloud study into an organization',()=>{
 const input={sourceId:study.id,revision:7,confirmed:true};
 const copy=(body:unknown=input,org=orgId)=>req(org+'&action=copy','POST',body);
 const source={study:{...study,status:'APPROVED'},revision:7};

 it('returns the authorized organization label without exposing its projects',async()=>{
  const db=mockDb();
  const result=await GET(req(orgId+'&action=copy'));
  expect(await result.json()).toEqual({organizationId:orgId,organizationName:'QA Organization'});
  expect(db.projects.select).not.toHaveBeenCalled();
 });

 it('requires explicit consent and rejects VIEWER writes before reading the source',async()=>{
  const db=mockDb();
  expect((await POST(copy({...input,confirmed:false}))).status).toBe(400);
  expect((await POST(copy({...input,study}))).status).toBe(400);
  expect(db.projects.select).not.toHaveBeenCalled();
  const viewer=mockDb('VIEWER');
  expect((await POST(copy())).status).toBe(403);
  expect(viewer.projects.select).not.toHaveBeenCalled();
 });

 it('copies only the exact owned personal revision and never changes the original',async()=>{
  const db=mockDb();
  db.projects.maybeSingle.mockResolvedValueOnce({data:source,error:null});
  expect((await POST(copy())).status).toBe(201);
  expect(db.projects.eq).toHaveBeenCalledWith('id',study.id);
  expect(db.projects.eq).toHaveBeenCalledWith('owner_user_id',userId);
  expect(db.projects.is).toHaveBeenCalledWith('organization_id',null);
  const [record]=db.projects.insert.mock.calls[0];
  expect(record).toMatchObject({organization_id:orgId,owner_user_id:null,created_by_user_id:userId,
   study:{id:record.id,status:'FEASIBILITY',title:study.title}});
  expect(record.id).not.toBe(study.id);
  expect(db.projects.update).not.toHaveBeenCalled();
  expect(source.study.status).toBe('APPROVED');
 });

 it('rejects missing, foreign and stale source revisions',async()=>{
  const db=mockDb();
  db.projects.maybeSingle.mockResolvedValueOnce({data:null,error:null});
  expect((await POST(copy())).status).toBe(404);
  db.projects.maybeSingle.mockResolvedValueOnce({data:{...source,revision:8},error:null});
  expect((await POST(copy())).status).toBe(409);
  expect(db.projects.insert).not.toHaveBeenCalled();
 });

 it('uses one stable identity per source and target and returns conflict on retries',async()=>{
  const db=mockDb();
  db.projects.maybeSingle.mockResolvedValue({data:source,error:null});
  await POST(copy());
  db.projects.single.mockResolvedValueOnce({data:null,error:{code:'23505'}});
  expect((await POST(copy({...input,sourceId:study.id.toUpperCase()},orgId.toUpperCase()))).status).toBe(409);
  await POST(copy(input,otherOrg));
  const ids=db.projects.insert.mock.calls.map(([record])=>record.id);
  expect(ids[0]).toBe(ids[1]);
  expect(ids[0]).not.toBe(ids[2]);
 });
});

describe('copy with organization-specific subscription checks enabled',()=>{
 beforeEach(()=>{process.env.FEASIBILITY_ORG_SHARING='true'});

 it('uses the receiving organization entitlement and resolves its verified name',async()=>{
  const db=mockDb();
  db.rpc.mockResolvedValue({data:{canRead:true,canWrite:true,canShare:false},error:null});
  const response=await GET(req(orgId+'&action=copy'));
  expect(await response.json()).toEqual({organizationId:orgId,organizationName:'QA Organization'});
  expect(db.rpc).toHaveBeenCalledWith('feasibility_company_workspace',{p_organization:orgId});
  expect(db.grant.select).not.toHaveBeenCalled();
  expect(db.org.eq).toHaveBeenCalledWith('id',orgId);
 });

 it('denies copy when the organization entitlement is read-only',async()=>{
  const db=mockDb();
  db.rpc.mockResolvedValue({data:{canRead:true,canWrite:false,canShare:true},error:null});
  expect((await POST(req(orgId+'&action=copy','POST',{sourceId:study.id,revision:1,confirmed:true}))).status).toBe(403);
  expect(db.projects.select).not.toHaveBeenCalled();
  expect(db.projects.insert).not.toHaveBeenCalled();
 });
});
