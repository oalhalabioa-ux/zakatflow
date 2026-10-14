import {beforeEach,it,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>({detail:vi.fn(),act:vi.fn()}));
vi.mock('../../../../services/payables',()=>({payableDetail:mocks.detail,actOnPayable:mocks.act}));
import {GET,POST} from './route';
const id='11111111-1111-4111-8111-111111111111',org='22222222-2222-4222-8222-222222222222',ctx={params:Promise.resolve({id})};
beforeEach(()=>vi.resetAllMocks());
it('requires a same origin request for payable writes',async()=>{expect((await POST(new Request('https://test/api/payables/'+id,{method:'POST',body:'{}'}),ctx)).status).toBe(403);expect(mocks.act).not.toHaveBeenCalled();});
it('passes the exact payable and company through and disables caching',async()=>{mocks.detail.mockResolvedValue({id});const r=await GET(new Request('https://test/api/payables/'+id+'?organization_id='+org),ctx);expect(r.status).toBe(200);expect(r.headers.get('Cache-Control')).toBe('no-store');expect(mocks.detail).toHaveBeenCalledWith(org,id);});
it('reports authorization failures and hides arbitrary database details',async()=>{mocks.detail.mockRejectedValue(new Error('FINANCIAL_CORE_VIEW_DENIED'));expect((await GET(new Request('https://test/api/payables/'+id),ctx)).status).toBe(403);mocks.detail.mockRejectedValue({message:'raw SQL secret'});const r=await GET(new Request('https://test/api/payables/'+id),ctx);expect(r.status).toBe(500);expect((await r.json()).error).toBe('PAYABLE_LOAD_FAILED');});
