import {beforeEach,afterEach,describe,expect,it,vi} from 'vitest';
import {createStudy,defaultLegalItems} from './engine';

const mocks=vi.hoisted(()=>({supabaseServer:vi.fn(),isSameOriginRequest:vi.fn()}));
vi.mock('@/lib/supabase/server',()=>({supabaseServer:mocks.supabaseServer}));
vi.mock('@/lib/request-origin',()=>({isSameOriginRequest:mocks.isSameOriginRequest}));
import {GET,POST} from '../../app/api/feasibility/reviews/route';

const owner='6357a708-bae2-4634-9296-490404b1d8a4';
const projectId='09d4c3bb-c5ee-4ac5-9b64-8127a2e55b98';
const old={studies:process.env.NEXT_PUBLIC_FEASIBILITY_STUDIES,cloud:process.env.NEXT_PUBLIC_FEASIBILITY_CLOUD_QA};
function readyStudy(){
 const s=createStudy(projectId,'Water facility');
 s.country='سوريا';s.currency='USD';
 s.status='APPROVED';
 s.investorEquity=100000;s.monthlyUnits=12000;s.unitPrice=2;s.variableCost=1;
 s.capex=[{id:'equipment',label:'Plant',amount:100000,category:'EQUIPMENT'}];
 s.legal=s.legal.map(x=>defaultLegalItems.slice(0,3).includes(x.title as typeof defaultLegalItems[number])?{...x,status:'VERIFIED'}:x);
 return s;
}
function post(body:unknown){
 return new Request('https://qa.local/api/feasibility/reviews',{method:'POST',
  headers:{Origin:'https://qa.local','Content-Type':'application/json'},body:JSON.stringify(body)});
}
function mockData(){
 const access={select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),
  maybeSingle:vi.fn().mockResolvedValue({data:{status:'ACTIVE',starts_at:'2026-11-01T00:00:00Z',ends_at:null},error:null})};
 const projects={select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),
  maybeSingle:vi.fn().mockResolvedValue({data:{id:projectId,revision:2,study:readyStudy()},error:null})};
 const reviews={select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),order:vi.fn().mockReturnThis(),
  limit:vi.fn().mockResolvedValue({data:[],error:null}),insert:vi.fn().mockReturnThis(),
  single:vi.fn().mockResolvedValue({data:{id:'1',project_id:projectId,source_revision:2,notes:'',created_at:'2026-11-09T00:00:00Z'},error:null})};
 const from=vi.fn((name:string)=>name==='feasibility_access_grants'?access:name==='feasibility_projects'?projects:reviews);
 const getUser=vi.fn().mockResolvedValue({data:{user:{id:owner}},error:null});
 mocks.supabaseServer.mockResolvedValue({from,auth:{getUser}});
 return {access,projects,reviews,from,getUser};
}
beforeEach(()=>{
 vi.resetAllMocks();mocks.isSameOriginRequest.mockReturnValue(true);
 process.env.NEXT_PUBLIC_FEASIBILITY_STUDIES='true';
 process.env.NEXT_PUBLIC_FEASIBILITY_CLOUD_QA='true';
});
afterEach(()=>{
 if(old.studies===undefined)delete process.env.NEXT_PUBLIC_FEASIBILITY_STUDIES;
 else process.env.NEXT_PUBLIC_FEASIBILITY_STUDIES=old.studies;
 if(old.cloud===undefined)delete process.env.NEXT_PUBLIC_FEASIBILITY_CLOUD_QA;
 else process.env.NEXT_PUBLIC_FEASIBILITY_CLOUD_QA=old.cloud;
});
describe('immutable internal review snapshot API',()=>{
 it('remains inaccessible when QA flags are disabled',async()=>{
  process.env.NEXT_PUBLIC_FEASIBILITY_CLOUD_QA='false';
  expect((await GET(new Request('https://qa.local/api/feasibility/reviews?project_id='+projectId))).status).toBe(404);
  expect((await POST(post({projectId,sourceRevision:2,notes:''}))).status).toBe(404);
  expect(mocks.supabaseServer).not.toHaveBeenCalled();
 });
 it('blocks writes from another origin without loading user data',async()=>{
  mockData();mocks.isSameOriginRequest.mockReturnValue(false);
  expect((await POST(post({projectId,sourceRevision:2,notes:''}))).status).toBe(403);
  expect(mocks.supabaseServer).not.toHaveBeenCalled();
 });
 it('requires an account licence and keeps history owner-scoped',async()=>{
  const {access,reviews}=mockData();
  access.maybeSingle.mockResolvedValueOnce({data:null,error:null});
  expect((await GET(new Request('https://qa.local/api/feasibility/reviews?project_id='+projectId))).status).toBe(403);
  expect((await GET(new Request('https://qa.local/api/feasibility/reviews?project_id='+projectId))).status).toBe(200);
  expect(reviews.eq).toHaveBeenCalledWith('owner_user_id',owner);
 });
 it('accepts an immutable internal review only from a ready saved source revision',async()=>{
  const {reviews,projects}=mockData();
  const response=await POST(post({projectId,sourceRevision:2,notes:'Decision meeting reviewed source evidence'}));
  expect(response.status).toBe(201);
  expect(projects.eq).toHaveBeenCalledWith('owner_user_id',owner);
  expect(reviews.insert).toHaveBeenCalledWith({project_id:projectId,source_revision:2,notes:'Decision meeting reviewed source evidence'});
  expect(JSON.stringify(reviews.insert.mock.calls)).not.toContain('study_snapshot');
 });
 it('rejects a stale revision and never inserts a snapshot',async()=>{
  const {reviews}=mockData();
  expect((await POST(post({projectId,sourceRevision:1,notes:''}))).status).toBe(409);
  expect(reviews.insert).not.toHaveBeenCalled();
 });
 it('rejects an incomplete study even when a client marked it approved',async()=>{
  const {projects,reviews}=mockData();
  const incomplete=readyStudy();incomplete.investorEquity=0;
  projects.maybeSingle.mockResolvedValueOnce({data:{id:projectId,revision:2,study:incomplete},error:null});
  expect((await POST(post({projectId,sourceRevision:2,notes:''}))).status).toBe(422);
  expect(reviews.insert).not.toHaveBeenCalled();
 });
 it('blocks immutable snapshots on extra funding with no assigned cash use',async()=>{
  const {projects,reviews}=mockData();
  const excess=readyStudy();excess.partnerCashEquity=5000;
  projects.maybeSingle.mockResolvedValueOnce({data:{id:projectId,revision:2,study:excess},error:null});
  expect((await POST(post({projectId,sourceRevision:2,notes:''}))).status).toBe(422);
  expect(reviews.insert).not.toHaveBeenCalled();
 });
 it('prevents an expired licence from recording a new review',async()=>{
  const {access,reviews}=mockData();
  access.maybeSingle.mockResolvedValueOnce({data:{status:'TRIAL',starts_at:'2026-10-01T00:00:00Z',ends_at:'2026-11-01T00:00:00Z'},error:null});
  expect((await POST(post({projectId,sourceRevision:2,notes:''}))).status).toBe(403);
  expect(reviews.insert).not.toHaveBeenCalled();
 });
 it('returns 409 on a duplicate immutable snapshot',async()=>{
  const {reviews}=mockData();
  reviews.single.mockResolvedValueOnce({data:null,error:{code:'23505',message:'duplicate'}});
  expect((await POST(post({projectId,sourceRevision:2,notes:''}))).status).toBe(409);
 });
});
