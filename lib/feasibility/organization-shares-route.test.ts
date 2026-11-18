import {PATCH as updateSharing} from '../../app/api/admin/settings/feasibility-sharing/route';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks=vi.hoisted(()=>({server:vi.fn(),sameOrigin:vi.fn()}));
vi.mock('@/lib/supabase/server',()=>({supabaseServer:mocks.server}));
vi.mock('@/lib/request-origin',()=>({isSameOriginRequest:mocks.sameOrigin}));
import { GET, POST } from '../../app/api/feasibility/organization-shares/route';

const organization='d7ed1c47-cc70-4cbd-aef4-8031df4f990a';
const project='3467a6e8-368a-46d1-979d-d0b8448d593f';
const recipient='527add11-d9c9-46e4-97f4-d0aeab796634';
const endpoint='https://qa.local/api/feasibility/organization-shares';
const rpc=vi.fn();

beforeEach(()=>{
 vi.resetAllMocks();
 vi.stubEnv('FEASIBILITY_ORG_SHARING','true');
 vi.stubEnv('FEASIBILITY_ORG_QA','true');
 vi.stubEnv('NEXT_PUBLIC_FEASIBILITY_STUDIES','true');
 mocks.sameOrigin.mockReturnValue(true);
 mocks.server.mockResolvedValue({auth:{getUser:async()=>({data:{user:{id:'authenticated'}},error:null})},rpc});
});
afterEach(()=>vi.unstubAllEnvs());

describe('organization shares endpoint',()=>{
 it('opens a study through the receiving membership RPC without consulting a personal license',async()=>{
  rpc.mockResolvedValue({data:{project_id:project},error:null});
  const response=await GET(new Request(endpoint+'?action=open&organization='+recipient+'&project='+project));
  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  expect(rpc).toHaveBeenCalledWith('feasibility_company_shares_access',{p_action:'open',p_organization:recipient,p_project:project});
 });
 it('treats expired and unauthorized open results without exposing study metadata',async()=>{
  rpc.mockResolvedValueOnce({data:null,error:null}).mockResolvedValueOnce({data:null,error:{code:'42501',message:'denied'}});
  const url=endpoint+'?action=open&organization='+recipient+'&project='+project;
  expect((await GET(new Request(url))).status).toBe(404);
  expect((await GET(new Request(url))).status).toBe(403);
 });
 it('requires a project for audit and only invokes the authorized audit RPC',async()=>{
  const query=endpoint+'?action=audit&organization='+organization;
  expect((await GET(new Request(query))).status).toBe(400);
  expect(rpc).not.toHaveBeenCalled();
  rpc.mockResolvedValueOnce({data:null,error:{code:'42501',message:'denied'}})
   .mockResolvedValueOnce({data:[],error:null});
  expect((await GET(new Request(query+'&project='+project))).status).toBe(403);
  const response=await GET(new Request(query+'&project='+project));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual([]);
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  expect(rpc).toHaveBeenLastCalledWith('feasibility_company_share_audit',{p_organization:organization,p_project:project});
 });
 it('preserves the host database 30-day limit and checks the request origin',async()=>{
  const payload={action:'share',organization,project,recipient,revision:2,days:31};
  const request=()=>new Request(endpoint,{method:'POST',body:JSON.stringify(payload)});
  mocks.sameOrigin.mockReturnValueOnce(false);
  expect((await POST(request())).status).toBe(403);
  expect(rpc).not.toHaveBeenCalled();
  rpc.mockResolvedValue({data:null,error:{code:'22023',message:'FEASIBILITY_NON_SUBSCRIBER_MAX_30_DAYS'}});
  const response=await POST(request());
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({error:'FEASIBILITY_NON_SUBSCRIBER_MAX_30_DAYS'});
 });
 it('forwards edit grants and rejects write attempts that contain organization identity fields',async()=>{
  rpc.mockResolvedValue({data:{ok:true},error:null});
  const request=(payload:unknown)=>new Request(endpoint,{method:'POST',body:JSON.stringify(payload)});
  const share={action:'share',organization,project,recipient,revision:2,days:5,access:'edit'};
  expect((await POST(request(share))).status).toBe(200);
  expect(rpc).toHaveBeenLastCalledWith('feasibility_company_shares_access',expect.objectContaining({p_access:'edit'}));
  const edit={action:'edit',organization:recipient,project,revision:2};
  expect((await POST(request({...edit,patch:{organization_id:organization}}))).status).toBe(400);
  expect((await POST(request({...edit,patch:{notes:'Updated'}}))).status).toBe(200);
  expect(rpc).toHaveBeenLastCalledWith('feasibility_company_shares_access',expect.objectContaining({p_patch:{notes:'Updated'}}));
 });

});

describe('platform sharing setting endpoint',()=>{
 const request=(mode:string)=>new Request('https://qa.local/api/admin/settings/feasibility-sharing',
  {method:'PATCH',body:JSON.stringify({mode})});
 it('checks origin and modes, then relies on the database platform owner authorization',async()=>{
  mocks.sameOrigin.mockReturnValueOnce(false);
  expect((await updateSharing(request('edit'))).status).toBe(403);
  expect((await updateSharing(request('unknown'))).status).toBe(400);
  expect(rpc).not.toHaveBeenCalled();
  rpc.mockResolvedValueOnce({data:null,error:{code:'42501'}}).mockResolvedValueOnce({data:'edit',error:null});
  expect((await updateSharing(request('edit'))).status).toBe(403);
  const saved=await updateSharing(request('edit'));
  expect(await saved.json()).toEqual({mode:'edit'});
  expect(rpc).toHaveBeenLastCalledWith('feasibility_manage_sharing',{p_mode:'edit'});
 });
});
