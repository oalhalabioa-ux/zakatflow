import {beforeEach,it,expect,vi} from 'vitest';
const m=vi.hoisted(()=>({auth:vi.fn(),rpc:vi.fn()}));
vi.mock('../../../services/auth',()=>({requireUser:m.auth}));
import {POST} from './route';
const id='11111111-1111-4111-8111-111111111111';
const command={action:'FUND',request_id:id,kind:'LOAN',side:'PAYABLE',source_debt_id:id,party:'Creditor',description:'Incoming loan transfer',reference:'July 2025',amount:14500,date:'2025-07-31',due_date:'2026-12-31',account_id:id};
beforeEach(()=>{vi.resetAllMocks();m.auth.mockResolvedValue({supabase:{rpc:m.rpc}});m.rpc.mockResolvedValue({data:{id},error:null});});
for(const origin of ['https://yaqeenbiz.com','https://www.yaqeenbiz.com','https://app.yaqeenbiz.com'])it('accepts same-origin hosted funding behind TLS: '+origin,async()=>{
 const r=await POST(new Request('http://localhost:3000/api/personal-financing',{method:'POST',headers:{origin,'sec-fetch-site':'same-origin'},body:JSON.stringify(command)}));
 expect(r.status).toBe(200);expect(m.rpc).toHaveBeenCalledTimes(1);expect(m.rpc).toHaveBeenCalledWith('linked_personal_debt_command',{p_payload:{operation:'FUND',command}});
});
for(const headers of [{},{origin:'https://evil.test','sec-fetch-site':'same-origin'},{origin:'https://www.yaqeenbiz.com','sec-fetch-site':'cross-site'},{origin:'https://www.yaqeenbiz.com'}])it('rejects missing or untrusted origin before auth and writes',async()=>{
 const r=await POST(new Request('http://localhost:3000/api/personal-financing',{method:'POST',headers:headers as Record<string,string>,body:JSON.stringify(command)}));expect(r.status).toBe(403);expect(m.auth).not.toHaveBeenCalled();expect(m.rpc).not.toHaveBeenCalled();
});

it('passes the chosen category with funding in one atomic RPC',async()=>{const payload={...command,category:'P_AP_PERSON'};const r=await POST(new Request('https://app.test/api/personal-financing',{method:'POST',headers:{origin:'https://app.test'},body:JSON.stringify(payload)}));expect(r.status).toBe(200);expect(m.rpc).toHaveBeenCalledTimes(1);expect(m.rpc).toHaveBeenCalledWith('linked_personal_debt_command',{p_payload:{operation:'FUND',command:payload}});});
it('rejects a category from another scope or debt side before writing',async()=>{for(const category of ['O_AP_SUPPLIER','P_AR_LOAN']){const r=await POST(new Request('https://app.test/api/personal-financing',{method:'POST',headers:{origin:'https://app.test'},body:JSON.stringify({...command,category})}));expect(r.status).toBe(400);}expect(m.rpc).not.toHaveBeenCalled();});
