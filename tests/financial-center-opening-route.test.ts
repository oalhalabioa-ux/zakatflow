import {beforeEach,afterEach,it,expect,vi} from 'vitest';
const state=vi.hoisted(()=>({command:vi.fn(),read:vi.fn()}));
vi.mock('../services/financial-dimensional-opening-workspace',()=>({dimensionalOpeningContext:()=>state.read(),dimensionalOpeningEditorContext:()=>state.read(),dimensionalOpeningCommand:(q:unknown)=>state.command(q)}));
import {GET,POST} from '../app/api/financial-reporting/center-openings/route';
const url='https://app.yaqeenbiz.com/api/financial-reporting/center-openings';
beforeEach(()=>{vi.resetAllMocks();vi.stubEnv('FINANCIAL_CENTER_BRANCH_REGISTRY','true');state.read.mockResolvedValue({status:'DRAFT'});state.command.mockResolvedValue({status:'DRAFT'})});afterEach(()=>vi.unstubAllEnvs());
it('rejects disabled and ambiguous contexts and never caches financial data',async()=>{
 vi.stubEnv('FINANCIAL_CENTER_BRANCH_REGISTRY','false');expect((await GET(new Request(url))).status).toBe(404);
 vi.stubEnv('FINANCIAL_CENTER_BRANCH_REGISTRY','true');expect((await GET(new Request(url+'?organization=x&organization=y&fiscalStart=2026-01-01'))).status).toBe(422);
 const r=await GET(new Request(url+'?organization=x&fiscalStart=2026-01-01&action=editor'));expect(r.status).toBe(200);expect(r.headers.get('Cache-Control')).toContain('no-store');
});
it('rejects cross-origin mutation and redacts database errors',async()=>{
 const request=(origin:string)=>new Request(url,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({action:'approve'})});
 expect((await POST(request('https://evil.example'))).status).toBe(403);expect(state.command).not.toHaveBeenCalled();
 state.command.mockRejectedValue(Error('DIMENSION_OPENING_VERSION_CONFLICT'));expect((await POST(request('https://app.yaqeenbiz.com'))).status).toBe(409);
 state.command.mockRejectedValue(Error('private database secret'));const r=await POST(request('https://app.yaqeenbiz.com'));expect(r.status).toBe(503);expect(await r.json()).toEqual({error:'DIMENSION_OPENING_UNAVAILABLE'});
});
it('limits editor reads, saves and approvals to the configured pilot',async()=>{
 const pilot='10000000-0000-4000-8000-000000000001';
 const other='10000000-0000-4000-8000-000000000009';
 vi.stubEnv('FINANCIAL_CENTER_OPENING_PILOT_ORGANIZATION',pilot);
 const get=(organization:string)=>GET(new Request(url+'?organization='+organization+'&fiscalStart=2026-01-01&action=editor'));
 const post=(body:object)=>POST(new Request(url,{method:'POST',headers:{origin:'https://app.yaqeenbiz.com','content-type':'application/json'},body:JSON.stringify(body)}));
 expect((await get(other)).status).toBe(404);
 expect((await post({action:'save',organization:other})).status).toBe(404);
 expect((await post({action:'approve',scope:{organization:other}})).status).toBe(404);
 expect((await post({action:'approve',organization:pilot})).status).toBe(404);
 expect(state.read).not.toHaveBeenCalled();
 expect(state.command).not.toHaveBeenCalled();
 vi.stubEnv('FINANCIAL_CENTER_BRANCH_REGISTRY','false');
 expect((await get(pilot)).status).toBe(200);
 expect((await post({action:'save',organization:pilot})).status).toBe(200);
 expect((await post({action:'approve',scope:{organization:pilot,fiscalStart:'2026-01-01'}})).status).toBe(200);
});
