import {beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({workspace:vi.fn(),action:vi.fn()}));
vi.mock('../../../services/investments',()=>({investmentWorkspace:mocks.workspace,investmentAction:mocks.action}));
import {GET,POST} from './route';
const org='20000000-0000-4000-8000-000000000001';
beforeEach(()=>vi.resetAllMocks());
it('passes only the requested personal/company/group context and prevents caching',async()=>{
 mocks.workspace.mockResolvedValue({contracts:[],operations:[]});
 let response=await GET(new Request('https://test/api/investments?scope=PERSONAL'));
 expect(response.status).toBe(200);expect(response.headers.get('Cache-Control')).toBe('no-store');
 expect(mocks.workspace).toHaveBeenLastCalledWith({scope:'PERSONAL',organization_id:null,group:false});
 response=await GET(new Request('https://test/api/investments?scope=ORGANIZATION&organization_id='+org+'&group=1'));
 expect(response.status).toBe(200);expect(mocks.workspace).toHaveBeenLastCalledWith({scope:'ORGANIZATION',organization_id:org,group:true});
});
it('rejects duplicate scope parameters and invalid grouping before reading investments',async()=>{
 expect((await GET(new Request('https://test/api/investments?scope=PERSONAL&scope=ORGANIZATION'))).status).toBe(400);
 expect((await GET(new Request('https://test/api/investments?scope=PERSONAL&group=unexpected'))).status).toBe(400);
 expect(mocks.workspace).not.toHaveBeenCalled();
});
it('denies unauthorized and foreign-company reads without caching the error response',async()=>{
 mocks.workspace.mockRejectedValueOnce(Error('UNAUTHORIZED'));
 let response=await GET(new Request('https://test/api/investments?scope=PERSONAL'));
 expect(response.status).toBe(401);expect(response.headers.get('Cache-Control')).toBe('no-store');
 mocks.workspace.mockRejectedValueOnce(Error('ORGANIZATION_ACCESS_REQUIRED'));
 response=await GET(new Request('https://test/api/investments?scope=ORGANIZATION&organization_id='+org));
 expect(response.status).toBe(403);
});
it('preserves the action envelope and withholds internal database error details',async()=>{
 const payload={action:'SAVE',workspace:{scope:'PERSONAL',organization_id:null,group:false},request_id:org,payload:{}};
 mocks.action.mockResolvedValueOnce({id:org});
 const response=await POST(new Request('https://test/api/investments',{method:'POST',body:JSON.stringify(payload)}));
 expect(response.status).toBe(200);expect(response.headers.get('Cache-Control')).toBe('no-store');expect(mocks.action).toHaveBeenCalledWith(payload);
 mocks.workspace.mockRejectedValueOnce(Error('private SQL query or unexpected database message'));
 const failed=await GET(new Request('https://test/api/investments?scope=PERSONAL'));
 expect(failed.status).toBe(500);expect(await failed.json()).toEqual({error:'INVESTMENT_FAILED'});
});
