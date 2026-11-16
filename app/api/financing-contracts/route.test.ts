import {beforeEach,it,expect,vi} from 'vitest';
const m=vi.hoisted(()=>({write:vi.fn(),settle:vi.fn()}));
vi.mock('../../../services/financing-contracts',()=>({financingAction:m.write,financingCharges:vi.fn()}));
vi.mock('../../../services/financing-settlements',()=>({financingSettlementAction:m.settle,financingSettlementRequests:vi.fn()}));
import {POST} from './route';
beforeEach(()=>{vi.resetAllMocks();m.write.mockResolvedValue({id:'draft'});m.settle.mockResolvedValue({id:'settlement'});});
it('accepts hosted same-origin financing writes behind TLS',async()=>{const r=await POST(new Request('http://localhost:3000/api/financing-contracts',{method:'POST',headers:{origin:'https://www.yaqeenbiz.com','sec-fetch-site':'same-origin'},body:JSON.stringify({action:'CREATE'})}));expect(r.status).toBe(200);expect(m.write).toHaveBeenCalledWith({action:'CREATE'});expect(m.settle).not.toHaveBeenCalled();});
it('rejects cross-site requests before calling financial services',async()=>{const r=await POST(new Request('http://localhost:3000/api/financing-contracts',{method:'POST',headers:{origin:'https://www.yaqeenbiz.com','sec-fetch-site':'cross-site'},body:JSON.stringify({action:'CREATE'})}));expect(r.status).toBe(403);expect(m.write).not.toHaveBeenCalled();expect(m.settle).not.toHaveBeenCalled();});
