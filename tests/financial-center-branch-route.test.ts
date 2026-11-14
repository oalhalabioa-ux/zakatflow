import {afterEach,beforeEach,it,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>({read:vi.fn(),write:vi.fn(),transfer:vi.fn()}));
vi.mock('../services/financial-center-branch-registry',()=>({centerBranchRegistry:mocks.read,assignCenterBranch:mocks.write,transferCenterBranch:mocks.transfer}));
import {GET,POST} from '../app/api/financial-reporting/center-branches/route';
const url='https://app.yaqeenbiz.com/api/financial-reporting/center-branches';
beforeEach(()=>{vi.stubEnv('FINANCIAL_CENTER_BRANCH_REGISTRY','true');mocks.read.mockReset().mockResolvedValue({revision:'1'});mocks.write.mockReset().mockResolvedValue({revision:2});mocks.transfer.mockReset().mockResolvedValue({revision:3})});
afterEach(()=>vi.unstubAllEnvs());
it('remains unavailable before schema rollout and does not call services',async()=>{
 vi.stubEnv('FINANCIAL_CENTER_BRANCH_REGISTRY','false');expect((await GET(new Request(url+'?organization=x'))).status).toBe(404);expect(mocks.read).not.toHaveBeenCalled();
});
it('rejects duplicate scope and serves non-cacheable editor registry',async()=>{
 expect((await GET(new Request(url+'?organization=x&organization=y'))).status).toBe(422);
 const r=await GET(new Request(url+'?organization=x'));expect(r.status).toBe(200);expect(r.headers.get('cache-control')).toBe('private, no-store');expect(mocks.read).toHaveBeenCalledWith({organization:'x'});
});
it('denies cross-origin writes and malformed JSON before assignment',async()=>{
 const request=(origin:string,body:string)=>new Request(url,{method:'POST',headers:{origin,'content-type':'application/json','sec-fetch-site':'same-origin'},body});
 expect((await POST(request('https://foreign.example','{}'))).status).toBe(403);
 expect((await POST(request('https://app.yaqeenbiz.com','{'))).status).toBe(422);expect(mocks.write).not.toHaveBeenCalled();
 expect((await POST(request('https://app.yaqeenbiz.com','{}'))).status).toBe(201);
});
it('does not leak database details and identifies optimistic conflicts',async()=>{
 mocks.read.mockRejectedValueOnce(Error('private query details'));let r=await GET(new Request(url+'?organization=x'));expect(r.status).toBe(503);expect(await r.json()).toEqual({error:'CENTER_BRANCH_UNAVAILABLE'});
 mocks.read.mockRejectedValueOnce(Error('CENTER_BRANCH_VERSION_CONFLICT'));r=await GET(new Request(url+'?organization=x'));expect(r.status).toBe(409);
});

it('routes transfer requests to the audited transfer command',async()=>{
 const body={action:'transfer',organization:'org'};
 const r=await POST(new Request(url,{method:'POST',headers:{origin:'https://app.yaqeenbiz.com','content-type':'application/json'},body:JSON.stringify(body)}));
 expect(r.status).toBe(201);expect(mocks.transfer).toHaveBeenCalledWith(body);expect(mocks.write).not.toHaveBeenCalled();
});
