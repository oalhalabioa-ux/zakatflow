import {beforeEach,it,expect,vi} from 'vitest';
const m=vi.hoisted(()=>({auth:vi.fn(),rpc:vi.fn()}));vi.mock('../../../services/auth',()=>({requireUser:m.auth}));
import {POST} from './route';
const id='11111111-1111-4111-8111-111111111111',command={action:'CREATE',request_id:id,party:'Creditor',description:'Existing debt',amount:100,date:'2026-10-14',due_date:null,reference:''};
beforeEach(()=>{vi.resetAllMocks();m.auth.mockResolvedValue({supabase:{rpc:m.rpc}});m.rpc.mockResolvedValue({data:{id},error:null});});
it('requires same origin before personal financial writes',async()=>{expect((await POST(new Request('https://app.test/api/personal-payables',{method:'POST',body:JSON.stringify(command)}))).status).toBe(403);expect(m.rpc).not.toHaveBeenCalled();});
it('passes validated commands to the caller-scoped atomic RPC',async()=>{const r=await POST(new Request('https://app.test/api/personal-payables',{method:'POST',headers:{origin:'https://app.test'},body:JSON.stringify(command)}));expect(r.status).toBe(200);expect(m.rpc).toHaveBeenCalledWith('personal_payable_command',{p_payload:command});expect(r.headers.get('cache-control')).toBe('no-store');});
it('rejects forged ownership before any write',async()=>{const r=await POST(new Request('https://app.test/api/personal-payables',{method:'POST',headers:{origin:'https://app.test'},body:JSON.stringify({...command,user_id:id})}));expect(r.status).toBe(400);expect(m.rpc).not.toHaveBeenCalled();});
