import {beforeEach,describe,it,expect,vi} from 'vitest';
import {branchFixture} from './financial-reporting/branch-report-fixture';
import {normalizeStatementSource} from '../lib/financial-statement-source';
const state=vi.hoisted(()=>({context:vi.fn(),source:vi.fn()}));
vi.mock('../services/financial-statement-live',()=>({assertLiveStatements:()=>{},liveStatementContext:()=>state.context(),liveStatementSource:(q:unknown)=>state.source(q)}));
import {liveGroupSourceReview} from '../services/financial-group-source-review';
const p=branchFixture().source,q={organization:p.organizationId,from:p.from,to:p.to};
const child='20000000-0000-4000-8000-000000000002';
beforeEach(()=>{vi.resetAllMocks();state.context.mockResolvedValue([{organizationId:q.organization,name:'Parent',parentOrganizationId:null},{organizationId:child,name:'Child',parentOrganizationId:q.organization}]);state.source.mockImplementation(async(query:typeof q)=>{const s=normalizeStatementSource(p,q);s.origin='LIVE_CANONICAL_EVENTS';s.statements.organizationId=query.organization;return s})});
describe('accessible group source review',()=>{
 it('verifies each company twice and never labels visible data consolidated',async()=>{const r=await liveGroupSourceReview(q);expect(r.members).toHaveLength(2);expect(r.consolidated).toBe(false);expect(r.registryComplete).toBe(false);expect(r).not.toHaveProperty('total');expect(state.source).toHaveBeenCalledTimes(4)});
 it('does not emit partial results for a denied subsidiary',async()=>{state.source.mockRejectedValueOnce(Error('REPORTING_ACCESS_DENIED'));await expect(liveGroupSourceReview(q)).rejects.toThrow('REPORTING_ACCESS_DENIED')});
 it('rejects hierarchy changes, cycles, and a mismatched source identity',async()=>{state.context.mockResolvedValueOnce([{organizationId:q.organization,name:'Parent',parentOrganizationId:null}]);await expect(liveGroupSourceReview(q)).rejects.toThrow('REPORTING_SOURCE_CHANGED_DURING_VERIFICATION');state.context.mockResolvedValue([{organizationId:q.organization,name:'Parent',parentOrganizationId:child},{organizationId:child,name:'Child',parentOrganizationId:q.organization}]);await expect(liveGroupSourceReview(q)).rejects.toThrow('REPORTING_GROUP_HIERARCHY_INVALID')});
});
