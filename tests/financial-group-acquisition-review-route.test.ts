import {beforeEach,afterEach,it,expect,vi} from 'vitest';
const state=vi.hoisted(()=>({preview:vi.fn(),command:vi.fn()}));
vi.mock('../services/financial-group-acquisition-review',()=>({reviewGroupAcquisition:(q:unknown)=>state.preview(q),commandGroupAcquisitionEvidence:(q:unknown)=>state.command(q)}));
import {POST} from '../app/api/financial-reporting/group-acquisition-review/route';
const url='https://app.yaqeenbiz.com/api/financial-reporting/group-acquisition-review';
const request=(body='{}',origin='https://app.yaqeenbiz.com')=>new Request(url,{method:'POST',headers:{origin,'content-type':'application/json'},body});
beforeEach(()=>{vi.resetAllMocks();vi.stubEnv('FINANCIAL_GROUP_ELIMINATION_PREVIEW','true');state.preview.mockResolvedValue({status:'UNAPPROVED_ACQUISITION_REVIEW'})});afterEach(()=>vi.unstubAllEnvs());
it('is disabled by default and blocks cross origin inputs before invoking any document command',async()=>{vi.stubEnv('FINANCIAL_GROUP_ELIMINATION_PREVIEW','false');expect((await POST(request())).status).toBe(404);vi.stubEnv('FINANCIAL_GROUP_ELIMINATION_PREVIEW','true');expect((await POST(request('{}','https://evil.example'))).status).toBe(403);expect(state.preview).not.toHaveBeenCalled()});
it('returns a private noncacheable document command result',async()=>{const r=await POST(request());expect(r.status).toBe(200);expect(r.headers.get('cache-control')).toContain('no-store');expect(await r.json()).toEqual({status:'UNAPPROVED_ACQUISITION_REVIEW'})});
it('rejects malformed or oversized bodies before compilation',async()=>{for(const b of['{','x'.repeat(200001)])expect((await POST(request(b))).status).toBe(400);expect(state.preview).not.toHaveBeenCalled()});
it('preserves denial and conflict statuses while hiding database details',async()=>{for(const [code,status] of [['REPORTING_ACCESS_DENIED',403],['REPORTING_SOURCE_CHANGED_DURING_VERIFICATION',409],['GROUP_ACQUISITION_FX_REQUIRED',422],['private internal secret',503]] as const){state.preview.mockRejectedValueOnce(Error(code));const r=await POST(request());expect(r.status).toBe(status);if(status===503)expect(await r.json()).toEqual({error:'REPORTING_UNAVAILABLE'})}});

it('sends explicit evidence decisions to the authenticated command handler',async()=>{
 state.command.mockResolvedValueOnce({status:'APPROVED'});
 const command={action:'APPROVE',id:'record-id'};
 const r=await POST(request(JSON.stringify(command)));
 expect(r.status).toBe(200);
 expect(state.command).toHaveBeenCalledWith(command);
 expect(state.preview).not.toHaveBeenCalled();
});
