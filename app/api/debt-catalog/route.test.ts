import {beforeEach,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({auth:vi.fn(),from:vi.fn()}));
vi.mock('../../../services/auth',()=>({requireUser:m.auth}));
import {GET} from './route';
beforeEach(()=>{vi.resetAllMocks();m.auth.mockResolvedValue({user:{id:'actor'},supabase:{from:m.from}});m.from.mockImplementation((table:string)=>{const value=table==='organization_members'?[{organization_id:'company'}]:table==='profiles'?{base_currency:'SAR'}:[{id:'company',name:'Company'}];const q:any={select:()=>q,eq:()=>q,in:()=>q,single:async()=>({data:value,error:null}),then:(resolve:any)=>Promise.resolve({data:value,error:null}).then(resolve)};return q})});
it('reads only memberships, base currency and accessible organizations for navigation',async()=>{const r=await GET();expect(r.status).toBe(200);expect(r.headers.get('Cache-Control')).toBe('no-store');expect(m.from.mock.calls.map(c=>c[0])).toEqual(['organization_members','profiles','organizations']);expect(await r.json()).toMatchObject({organizations:[{id:'company'}]})});
it('rejects unauthenticated navigation reads before querying any catalog',async()=>{m.auth.mockRejectedValue(Error('UNAUTHORIZED'));const r=await GET();expect(r.status).toBe(401);expect(m.from).not.toHaveBeenCalled()});
