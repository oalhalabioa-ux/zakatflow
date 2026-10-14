import {beforeEach,it,expect,vi} from 'vitest';
const m=vi.hoisted(()=>({read:vi.fn(),write:vi.fn()}));vi.mock('../../../services/debt-contracts',()=>({debtContracts:m.read,debtContractAction:m.write}));
import {GET,POST} from './route';
beforeEach(()=>{vi.resetAllMocks();m.read.mockResolvedValue({contracts:[]});m.write.mockResolvedValue({status:'COMMITTED'});});
it('requires same-origin on debt contract writes',async()=>{expect((await POST(new Request('https://app.test/api/debt-contracts',{method:'POST',body:'{}'}))).status).toBe(403);expect(m.write).not.toHaveBeenCalled();});
it('never caches debt reads and hides private error details',async()=>{const r=await GET(new Request('https://app.test/api/debt-contracts?organization_id=org'));expect(r.headers.get('cache-control')).toBe('no-store');m.read.mockRejectedValue(new Error('private database details'));expect(await(await GET(new Request('https://app.test/api/debt-contracts'))).json()).toEqual({error:'DEBT_CONTRACT_FAILED'});});
