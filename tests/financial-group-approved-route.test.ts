import {beforeEach,afterEach,it,expect,vi} from 'vitest';
const state=vi.hoisted(()=>({preview:vi.fn(),acquisitions:vi.fn()}));
vi.mock('../services/financial-group-elimination-batches',()=>({readApprovedGroupEliminations:(q:unknown)=>state.preview(q)}));
vi.mock('../services/financial-group-acquisition-review',()=>({readApprovedGroupAcquisitions:(q:unknown)=>state.acquisitions(q)}));
import {POST} from '../app/api/financial-reporting/group-approved-eliminations/route';
const url='https://app.yaqeenbiz.com/api/financial-reporting/group-approved-eliminations';
const request=(body='{}',origin='https://app.yaqeenbiz.com')=>new Request(url,{method:'POST',headers:{origin,'content-type':'application/json'},body});
beforeEach(()=>{vi.resetAllMocks();vi.stubEnv('FINANCIAL_GROUP_ELIMINATION_PREVIEW','true');state.preview.mockResolvedValue({status:'APPROVED_GROUP_ADJUSTMENT_WORKSHEET'})});afterEach(()=>vi.unstubAllEnvs());
it('is disabled by default and blocks cross origin inputs before invoking any document command',async()=>{vi.stubEnv('FINANCIAL_GROUP_ELIMINATION_PREVIEW','false');expect((await POST(request())).status).toBe(404);vi.stubEnv('FINANCIAL_GROUP_ELIMINATION_PREVIEW','true');expect((await POST(request('{}','https://evil.example'))).status).toBe(403);expect(state.preview).not.toHaveBeenCalled()});
it('returns a private noncacheable document command result',async()=>{const r=await POST(request());expect(r.status).toBe(200);expect(r.headers.get('cache-control')).toContain('no-store');expect(await r.json()).toEqual({status:'APPROVED_GROUP_ADJUSTMENT_WORKSHEET'})});
it('rejects malformed or oversized bodies before compilation',async()=>{for(const b of['{','x'.repeat(200001)])expect((await POST(request(b))).status).toBe(400);expect(state.preview).not.toHaveBeenCalled()});
it('preserves denial and conflict statuses while hiding database details',async()=>{for(const [code,status] of [['REPORTING_ACCESS_DENIED',403],['REPORTING_SOURCE_CHANGED_DURING_VERIFICATION',409],['GROUP_BATCH_APPROVAL_REQUIRED',422],['private internal secret',503]] as const){state.preview.mockRejectedValueOnce(Error(code));const r=await POST(request());expect(r.status).toBe(status);if(status===503)expect(await r.json()).toEqual({error:'REPORTING_UNAVAILABLE'})}});

it('rejects export if acquisition approval changes while the worksheet is read',async()=>{
 const query={organization:'10000000-0000-4000-8000-000000000001',from:'2026-01-01',to:'2026-12-31'};
 state.acquisitions.mockResolvedValueOnce({status:'APPROVED_ACQUISITION_REVIEW',query,rows:[{id:'approved'}]})
  .mockResolvedValueOnce({status:'APPROVED_ACQUISITION_REVIEW',query,rows:[]});
 const response=await POST(request(JSON.stringify({action:'EXPORT',query})));
 expect(response.status).toBe(409);
 expect(await response.json()).toEqual({error:'REPORTING_SOURCE_CHANGED_DURING_VERIFICATION'});
 expect(state.preview).toHaveBeenCalledWith(query);
});
it('fails the export if acquisition access is denied instead of treating the result as empty',async()=>{
 const query={organization:'10000000-0000-4000-8000-000000000001',from:'2026-01-01',to:'2026-12-31'};
 state.acquisitions.mockRejectedValue(Error('GROUP_CONTROL_READ_DENIED'));
 const response=await POST(request(JSON.stringify({action:'EXPORT',query})));
 expect(response.status).toBe(403);
 expect(state.preview).not.toHaveBeenCalled();
});
