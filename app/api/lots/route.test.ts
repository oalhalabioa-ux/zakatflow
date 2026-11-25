import {beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({list:vi.fn(),detail:vi.fn()}));
vi.mock('../../../services/lots',()=>({listLots:mocks.list,getLot:mocks.detail}));
import {GET} from './route';
import {GET as detailGET} from './[id]/route';
import {lotWorkspaceQuery} from '../../../lib/lot-workspace-scope';
const org='20000000-0000-4000-8000-000000000001';
beforeEach(()=>vi.resetAllMocks());
it('keeps personal requests free of stale company IDs and forwards exact company/group requests',async()=>{
 expect(lotWorkspaceQuery('PERSONAL',org,true)).toBe('scope=PERSONAL');expect(lotWorkspaceQuery('ORGANIZATION','',true)).toBeNull();
 mocks.list.mockResolvedValue([]);
 let response=await GET(new Request('https://test/api/lots'));expect(response.status).toBe(200);expect(response.headers.get('Cache-Control')).toBe('no-store');
 expect(mocks.list).toHaveBeenLastCalledWith({scope:'PERSONAL',organization_id:null,group:false});
 response=await GET(new Request('https://test/api/lots?'+lotWorkspaceQuery('ORGANIZATION',org,true)));expect(response.status).toBe(200);
 expect(mocks.list).toHaveBeenLastCalledWith({scope:'ORGANIZATION',organization_id:org,group:true});
});
it('rejects mixed, malformed, duplicate and missing company selections before accessing lots',async()=>{
 for(const query of ['scope=ORGANIZATION','scope=PERSONAL&organization_id='+org,'scope=PERSONAL&scope=ORGANIZATION','scope=ORGANIZATION&organization_id='+org+'&group=other','scope=unknown'])expect((await GET(new Request('https://test/api/lots?'+query))).status).toBe(400);
 expect(mocks.list).not.toHaveBeenCalled();
});
it('preserves the flat authorized detail contract with no caching and fails closed on denied records',async()=>{
 mocks.detail.mockResolvedValueOnce({id:org,organization_id:org,asset_accounts:{ownership_scope:'ORGANIZATION',organization_id:org}});
 const response=await detailGET(new Request('https://test/api/lots/'+org),{params:Promise.resolve({id:org})});expect(response.status).toBe(200);expect(response.headers.get('Cache-Control')).toBe('no-store');expect((await response.json()).organization_id).toBe(org);
 mocks.detail.mockRejectedValueOnce(Error('ORGANIZATION_ACCESS_REQUIRED'));
 expect((await detailGET(new Request('https://test/api/lots/'+org),{params:Promise.resolve({id:org})})).status).toBe(403);
 mocks.detail.mockRejectedValueOnce(Error('LOT_NOT_FOUND'));
 expect((await detailGET(new Request('https://test/api/lots/'+org),{params:Promise.resolve({id:org})})).status).toBe(404);
});
it('withholds internal query errors and preserves safe database permission errors',async()=>{
 mocks.list.mockRejectedValueOnce({message:'private SQL query text'});
 const response=await GET(new Request('https://test/api/lots'));expect(response.status).toBe(500);expect(await response.json()).toEqual({error:'LOT_LOAD_FAILED'});
 mocks.list.mockRejectedValueOnce({message:'LOT_ACCESS_DENIED'});expect((await GET(new Request('https://test/api/lots'))).status).toBe(403);
});
