import {beforeEach,describe,it,expect,vi} from 'vitest';
const {auth}=vi.hoisted(()=>({auth:vi.fn()}));
vi.mock('../../../services/auth',()=>({requireUser:auth}));
import {GET} from './route';
const row=(rate:number,source='Global')=>({id:String(rate),organization_id:null,from_currency:'USD',to_currency:'SAR',rate,valuation_date:'2026-10-01',source});
function setup(pages:unknown[][],error?:unknown){const range=vi.fn();pages.forEach(data=>range.mockResolvedValueOnce({data,error}));const q:any={select:vi.fn(),lte:vi.fn(),gt:vi.fn(),order:vi.fn(),range};for(const key of ['select','lte','gt','order'])q[key].mockReturnValue(q);const from=vi.fn().mockReturnValue(q);auth.mockResolvedValue({supabase:{from}});return {q,from};}
beforeEach(()=>vi.clearAllMocks());
describe('authenticated display FX reference endpoint',()=>{
 it('returns only latest references without exposing row identifiers or caching across users',async()=>{const {q,from}=setup([[row(3.75,'Latest'),row(3.8,'Older')]]);const response=await GET();const data=await response.json();expect(response.status).toBe(200);expect(data).toHaveLength(1);expect(data[0]).toMatchObject({rate:3.75,source:'Latest'});expect(data[0]).not.toHaveProperty('id');expect(response.headers.get('Cache-Control')).toBe('private, no-store');expect(from).toHaveBeenCalledWith('fx_rates');expect(q.gt).toHaveBeenCalledWith('rate',0);expect(q.lte).toHaveBeenCalledWith('valuation_date',expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));});
 it('reads later pages instead of silently losing organization references',async()=>{const other={...row(122),organization_id:'A',to_currency:'SYP'};const {q}=setup([Array.from({length:500},()=>row(3.75)),[other]]);expect(await (await GET()).json()).toHaveLength(2);expect(q.range.mock.calls).toEqual([[0,499],[500,999]]);});
 it('rejects unauthenticated access',async()=>{auth.mockRejectedValueOnce(new Error('UNAUTHORIZED'));expect((await GET()).status).toBe(401);});
 it('does not return a partial rate catalog on query failure',async()=>{setup([[]],new Error('Unavailable'));expect((await GET()).status).toBe(500);});
});
