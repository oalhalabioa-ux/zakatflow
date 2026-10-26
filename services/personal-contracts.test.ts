import {beforeEach,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({auth:vi.fn(),rpc:vi.fn()}));vi.mock('./auth',()=>({requireUser:m.auth}));vi.mock('./financial-register',()=>({financialRegister:vi.fn()}));
import {personalContractAction} from './personal-contracts';
const id='11111111-1111-4111-8111-111111111111';
beforeEach(()=>{vi.resetAllMocks();m.auth.mockResolvedValue({supabase:{rpc:m.rpc},user:{id}});m.rpc.mockResolvedValue({data:{id},error:null});});
it('requires authentication before executing a valid contract command',async()=>{m.auth.mockRejectedValue(Error('UNAUTHORIZED'));await expect(personalContractAction({action:'EXECUTE',id,expected_revision:0,reason:'Execute contract'})).rejects.toThrow('UNAUTHORIZED');expect(m.rpc).not.toHaveBeenCalled();});
it('sends exactly one validated atomic command and does not run separate cash writes',async()=>{const p={action:'EXECUTE',id,expected_revision:0,reason:'Execute contract'};await personalContractAction(p);expect(m.rpc).toHaveBeenCalledExactlyOnceWith('personal_contract_command',{p_payload:p});});
it('rejects manipulated ownership and future cash dates without calling the writer',async()=>{await expect(personalContractAction({action:'EXECUTE',id,expected_revision:0,reason:'Execute contract',user_id:id})).rejects.toThrow();await expect(personalContractAction({action:'SETTLE',id,request_id:id,date:'2099-01-01',amount:1,account_id:id,reason:'Future date'})).rejects.toThrow('DATE_IN_FUTURE');expect(m.rpc).not.toHaveBeenCalled();});
