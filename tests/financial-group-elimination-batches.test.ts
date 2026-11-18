import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {sourceBoundGroupFixture} from './financial-reporting/group-source-bound-fixture';
const state=vi.hoisted(()=>({rpc:vi.fn(),preview:vi.fn()}));
vi.mock('../services/auth',()=>({requireUser:async()=>({supabase:{rpc:state.rpc}})}));
vi.mock('../services/financial-group-source-bound-adjustments',()=>({liveSourceBoundGroupPreview:(i:unknown)=>state.preview(i)}));
import {commandGroupEliminationBatch,readApprovedGroupEliminations} from '../services/financial-group-elimination-batches';
const id='90000000-0000-4000-8000-000000000001',f=sourceBoundGroupFixture();
const query={organization:f.control.rootOrganizationId,from:f.control.from,to:f.control.to};
const save={action:'SAVE',query,entries:[{...f.entry,documentMatchId:id}],expectedVersion:0,reason:'Review group only adjustment',requestId:id};
beforeEach(()=>{vi.resetAllMocks();vi.stubEnv('FINANCIAL_GROUP_ELIMINATION_PREVIEW','true');state.preview.mockResolvedValue({documents:{status:'DOCUMENT_MATCHES_VERIFIED_ONLY'}});state.rpc.mockResolvedValue({data:{id,version:1,status:'DRAFT'},error:null})});afterEach(()=>vi.unstubAllEnvs());
it('does not persist without successful independent verification',async()=>{state.preview.mockRejectedValue(Error('REPORTING_ACCESS_DENIED'));await expect(commandGroupEliminationBatch(save)).rejects.toThrow('DENIED');expect(state.rpc).not.toHaveBeenCalled()});
it('requires approved documentary matching and forbids client source evidence',async()=>{state.preview.mockResolvedValue({documents:{status:'DOCUMENT_MATCHING_REQUIRED'}});await expect(commandGroupEliminationBatch(save)).rejects.toThrow('DOCUMENT_NOT_APPROVED');await expect(commandGroupEliminationBatch({...save,evidence:f.sources})).rejects.toThrow();expect(state.rpc).not.toHaveBeenCalled()});
it('passes the scoped version and idempotency key to the database validator',async()=>{expect(await commandGroupEliminationBatch(save)).toEqual({id,version:1,status:'DRAFT'});expect(state.rpc).toHaveBeenCalledWith('save_financial_group_eliminations',expect.objectContaining({p_expected_version:0,p_request_id:id,p_root:query.organization,p_entries:save.entries}))});
it('does not approve a batch outside the selected reporting scope',async()=>{state.rpc.mockResolvedValue({data:{status:'GROUP_ELIMINATION_EVIDENCE_ONLY',batches:[{id,root_organization_id:f.entry.debitSource.organizationId,period_from:query.from,period_to:query.to,version:1,status:'DRAFT',entries:save.entries}]},error:null});await expect(commandGroupEliminationBatch({action:'APPROVE',query,batchId:id,expectedVersion:1,reason:save.reason})).rejects.toThrow('REPORTING_ACCESS_DENIED');expect(state.rpc).toHaveBeenCalledTimes(1);expect(state.preview).not.toHaveBeenCalled()});
it('preserves SQL conflict and authorization outcomes without exposing internal failures',async()=>{state.rpc.mockResolvedValueOnce({data:null,error:{message:'GROUP_BATCH_VERSION_CONFLICT'}});await expect(commandGroupEliminationBatch(save)).rejects.toThrow('VERSION_CONFLICT');state.rpc.mockResolvedValueOnce({data:null,error:{message:'private password exception'}});await expect(commandGroupEliminationBatch(save)).rejects.toThrow('REPORTING_GROUP_BATCH_UNAVAILABLE')});
it('stays disabled until explicitly enabled',async()=>{vi.stubEnv('FINANCIAL_GROUP_ELIMINATION_PREVIEW','false');await expect(commandGroupEliminationBatch(save)).rejects.toThrow('REPORTING_DISABLED');expect(state.rpc).not.toHaveBeenCalled()});

const evidence={status:'APPROVED_GROUP_ELIMINATION_EVIDENCE',id,version:1,rootOrganizationId:query.organization,
 from:query.from,to:query.to,entries:save.entries,approvedBy:id,approvedAt:'2026-11-15T08:00:00+00:00',evidenceFingerprint:'a'.repeat(32)};
it('reads approved entries with independent verification and a final evidence reread',async()=>{
 state.rpc.mockResolvedValue({data:evidence,error:null});
 const result=await readApprovedGroupEliminations(query);
 expect(result.status).toBe('APPROVED_GROUP_ADJUSTMENT_WORKSHEET');expect(result.consolidated).toBe(false);
 expect(state.preview).toHaveBeenCalledWith({query,entries:save.entries});expect(state.rpc).toHaveBeenCalledTimes(2);
});
it('rejects replacement approval or evidence changes during the independent read',async()=>{
 state.rpc.mockResolvedValueOnce({data:evidence,error:null}).mockResolvedValueOnce({data:{...evidence,version:2},error:null});
 await expect(readApprovedGroupEliminations(query)).rejects.toThrow('SOURCE_CHANGED_DURING_VERIFICATION');
});
it('never exposes a saved but unapproved or invalid batch as approved',async()=>{
 state.rpc.mockResolvedValue({data:null,error:{message:'GROUP_BATCH_APPROVAL_REQUIRED'}});
 await expect(readApprovedGroupEliminations(query)).rejects.toThrow('APPROVAL_REQUIRED');expect(state.preview).not.toHaveBeenCalled();
 state.rpc.mockResolvedValue({data:{...evidence,approvedBy:null},error:null});
 await expect(readApprovedGroupEliminations(query)).rejects.toThrow('BATCH_INVALID');
});
it('rejects cross-scope evidence before reading original sources',async()=>{
 state.rpc.mockResolvedValue({data:{...evidence,to:'2025-12-31'},error:null});
 await expect(readApprovedGroupEliminations(query)).rejects.toThrow('ACCESS_DENIED');expect(state.preview).not.toHaveBeenCalled();
});
it('rejects evidence revocation after independent verification',async()=>{
 state.rpc.mockResolvedValueOnce({data:evidence,error:null}).mockResolvedValueOnce({data:null,error:{message:'GROUP_BATCH_DOCUMENT_NOT_APPROVED'}});
 await expect(readApprovedGroupEliminations(query)).rejects.toThrow('DOCUMENT_NOT_APPROVED');
});
