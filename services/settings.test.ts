import {beforeEach,expect,it,vi} from 'vitest';
const {requireUser}=vi.hoisted(()=>({requireUser:vi.fn()}));
vi.mock('./auth',()=>({requireUser}));
import {getSettings} from './settings';
let profileResult: any,settingsResult: any;
beforeEach(()=>{
 profileResult={data:{id:'self',name:'Account'},error:null};
 settingsResult={data:null,error:null};
 requireUser.mockResolvedValue({user:{id:'self'},supabase:{from:(table:string)=>({select:()=>({eq:(column:string,id:string)=>{
  expect(id).toBe('self');expect(column).toBe(table==='profiles'?'id':'user_id');
  return {single:async()=>profileResult,maybeSingle:async()=>settingsResult};
 }})})}});
});
it('loads an account provisioned without preferences, without performing a write',async()=>{
 const r=await getSettings();expect(r.profile.name).toBe('Account');
 expect(r.settings).toMatchObject({user_id:'self',allocation_method:'FIFO'});
});
it('preserves previously saved preferences',async()=>{
 settingsResult.data={user_id:'self',allocation_method:'MANUAL',theme:'custom'};
 expect((await getSettings()).settings).toEqual(settingsResult.data);
});
it('does not turn a permissions or schema failure into default preferences',async()=>{
 settingsResult.error=new Error('permission denied');
 await expect(getSettings()).rejects.toThrow('permission denied');
});
it('keeps missing or inaccessible profiles as an error',async()=>{
 profileResult.error=new Error('profile unavailable');
 await expect(getSettings()).rejects.toThrow('profile unavailable');
});
