import {beforeEach,it,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>({workspace:vi.fn(),action:vi.fn()}));
vi.mock('../../../services/advances',()=>({advanceWorkspace:mocks.workspace,advanceAction:mocks.action}));
import {GET,POST} from './route';
beforeEach(()=>{vi.resetAllMocks()});
it('requires same origin before accepting a payment command',async()=>{const r=await POST(new Request('https://app.test/api/advances?organization_id=org',{method:'POST',body:'{}'}));expect(r.status).toBe(403);expect(mocks.action).not.toHaveBeenCalled();});
it('preserves organization scope and prevents caching financial balances',async()=>{mocks.workspace.mockResolvedValue({advances:[]});const r=await GET(new Request('https://app.test/api/advances?organization_id=org'));expect(mocks.workspace).toHaveBeenCalledWith('org');expect(r.headers.get('Cache-Control')).toBe('no-store');expect(await r.json()).toEqual({advances:[]});});
it('keeps internal database details out of error responses',async()=>{mocks.action.mockRejectedValue(Error('duplicate key contains private details'));const r=await POST(new Request('https://app.test/api/advances?organization_id=org',{method:'POST',headers:{origin:'https://app.test'},body:'{}'}));expect(r.status).toBe(500);expect(await r.json()).toEqual({error:'ADVANCE_REQUEST_FAILED'});});
