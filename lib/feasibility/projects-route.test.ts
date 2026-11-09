import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {createStudy} from './engine';

const mocks=vi.hoisted(()=>({supabaseServer:vi.fn(),isSameOriginRequest:vi.fn()}));
vi.mock('@/lib/supabase/server',()=>({supabaseServer:mocks.supabaseServer}));
vi.mock('@/lib/request-origin',()=>({isSameOriginRequest:mocks.isSameOriginRequest}));
import {GET,POST,PATCH,DELETE} from '@/app/api/feasibility/projects/route';

const owner='6357a708-bae2-4634-9296-490404b1d8a4';
const studyId='09d4c3bb-c5ee-4ac5-9b64-8127a2e55b98';
const originalFlags={studies:process.env.NEXT_PUBLIC_FEASIBILITY_STUDIES,cloud:process.env.NEXT_PUBLIC_FEASIBILITY_CLOUD_QA};

function request(method:'POST'|'PATCH'|'DELETE',data?:unknown){
 return new Request('https://qa.local/api/feasibility/projects'+(method==='DELETE'?'?id='+studyId:''),{
  method,headers:{'Content-Type':'application/json',Origin:'https://qa.local'},
  ...(method==='DELETE'?{}:{body:JSON.stringify(data)})
 });
}
function mockData(){
 const q={
  select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),order:vi.fn().mockReturnThis(),
  limit:vi.fn().mockResolvedValue({data:[],error:null}),
  insert:vi.fn().mockReturnThis(),update:vi.fn().mockReturnThis(),delete:vi.fn().mockReturnThis(),
  single:vi.fn().mockResolvedValue({data:{id:studyId,revision:1},error:null}),
  maybeSingle:vi.fn().mockResolvedValue({data:null,error:null})
 };
 const from=vi.fn().mockReturnValue(q);
 const getUser=vi.fn().mockResolvedValue({data:{user:{id:owner}},error:null});
 mocks.supabaseServer.mockResolvedValue({from,auth:{getUser}});
 return {q,from,getUser};
}
beforeEach(()=>{
 vi.resetAllMocks();
 process.env.NEXT_PUBLIC_FEASIBILITY_STUDIES='true';
 process.env.NEXT_PUBLIC_FEASIBILITY_CLOUD_QA='true';
 mocks.isSameOriginRequest.mockReturnValue(true);
});
afterEach(()=>{
 for(const [key,value] of [['NEXT_PUBLIC_FEASIBILITY_STUDIES',originalFlags.studies],['NEXT_PUBLIC_FEASIBILITY_CLOUD_QA',originalFlags.cloud]] as const)
  if(value===undefined)delete process.env[key];else process.env[key]=value;
});
describe('QA V2 feasibility cloud route',()=>{
 it('fails closed when feature flags are off without touching Supabase',async()=>{
  process.env.NEXT_PUBLIC_FEASIBILITY_CLOUD_QA='false';
  expect((await GET()).status).toBe(404);
  expect((await POST(request('POST',{study:createStudy(studyId,'Draft')}))).status).toBe(404);
  expect(mocks.supabaseServer).not.toHaveBeenCalled();
 });
 it('requires a real authenticated owner for reads',async()=>{
  const {getUser}=mockData();
  getUser.mockResolvedValueOnce({data:{user:null},error:null});
  const res=await GET();
  expect(res.status).toBe(401);
  expect(res.headers.get('Cache-Control')).toBe('private, no-store');
 });
 it('reads only rows scoped to the authenticated user',async()=>{
  const {q,from}=mockData();
  const res=await GET();
  expect(res.status).toBe(200);
  expect(from).toHaveBeenCalledWith('feasibility_projects');
  expect(q.eq).toHaveBeenCalledWith('owner_user_id',owner);
 });
 it('rejects cross-origin mutations before authentication',async()=>{
  mocks.isSameOriginRequest.mockReturnValue(false);
  expect((await POST(request('POST',{study:createStudy(studyId,'Draft')}))).status).toBe(403);
  expect((await PATCH(request('PATCH',{study:createStudy(studyId,'Draft'),revision:1}))).status).toBe(403);
  expect((await DELETE(request('DELETE'))).status).toBe(403);
  expect(mocks.supabaseServer).not.toHaveBeenCalled();
 });
 it('rejects forged owner fields and malformed payloads',async()=>{
  const {q}=mockData();
  const study=createStudy(studyId,'Draft');
  expect((await POST(request('POST',{study:{...study,owner_user_id:owner}}))).status).toBe(400);
  expect((await POST(request('POST',{study:{...study,id:'bad'}}))).status).toBe(400);
  expect(q.insert).not.toHaveBeenCalled();
 });
 it('assigns the owner from auth for inserts, not client data',async()=>{
  const {q}=mockData();
  const study=createStudy(studyId,'Draft');
  const res=await POST(request('POST',{study}));
  expect(res.status).toBe(201);
  expect(q.insert).toHaveBeenCalledWith({id:studyId,owner_user_id:owner,title:'Draft',study});
 });
 it('rejects stale updates without overwriting another revision',async()=>{
  const {q}=mockData();
  const study=createStudy(studyId,'Draft');
  expect((await PATCH(request('PATCH',{study,revision:2}))).status).toBe(409);
  expect(q.eq).toHaveBeenCalledWith('revision',2);
  expect(q.eq).toHaveBeenCalledWith('owner_user_id',owner);
 });
 it('rejects missing revision and malformed delete identifiers',async()=>{
  const {q}=mockData();
  const study=createStudy(studyId,'Draft');
  expect((await PATCH(request('PATCH',{study}))).status).toBe(400);
  expect(q.update).not.toHaveBeenCalled();
  const invalid=new Request('https://qa.local/api/feasibility/projects?id=invalid',{method:'DELETE',headers:{Origin:'https://qa.local'}});
  expect((await DELETE(invalid)).status).toBe(400);
  expect(q.delete).not.toHaveBeenCalled();
 });
});
