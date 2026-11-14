import {beforeEach,it,expect,vi} from 'vitest';
import {branchFixture} from './financial-reporting/branch-report-fixture';
import {normalizeStatementSource} from '../lib/financial-statement-source';
const state=vi.hoisted(()=>({rpc:vi.fn(),verify:vi.fn(),auth:vi.fn(),read:vi.fn(),registry:vi.fn(),branches:vi.fn()}));
vi.mock('../services/auth',()=>({requireUser:()=>state.auth()}));
vi.mock('../services/financial-statement-live',()=>({assertLiveStatements:()=>{},liveStatementSource:(q:unknown)=>state.verify(q)}));
vi.mock('../services/financial-center-branch-registry',()=>({centerBranchRegistry:()=>state.registry()}));
vi.mock('../services/financial-branch-journal-source',()=>({observeCanonicalJournalBranches:()=>state.branches()}));
import {liveDimensionalStatements} from '../services/financial-dimensional-statements';
function raw(){const p=branchFixture().source;p.opening=[];p.openingSourceId=`FIRST_ACTIVITY:${p.fiscalStart}`;delete (p as {controls?:unknown}).controls;return p}
const query=()=>({organization:raw().organizationId,from:raw().from,to:raw().to});
function rows(){const p=raw();return [...new Map(p.events.flatMap(e=>e.lines.map(l=>{const id=l.id.split(':')[0];return[id,{id,event_id:e.id,organization_id:p.organizationId,cost_center_id:'center'}] as const}))).values()]}
function registry(){const p=raw();return{organizationId:p.organizationId,complete:true,revision:'1',branches:[],centerIds:['center'],assignments:[{id:'assignment',organizationId:p.organizationId,centerId:'center',branchId:null,from:p.fiscalStart,to:null,status:'APPROVED',approvedBy:'owner',revision:'1'}]}}
beforeEach(()=>{vi.resetAllMocks();state.rpc.mockResolvedValue({data:raw(),error:null});state.verify.mockResolvedValue(normalizeStatementSource(raw(),query()));state.registry.mockResolvedValue(registry());state.branches.mockResolvedValue({organizationId:raw().organizationId,links:raw().events.map(e=>({journalId:e.id,branchId:null}))});state.read.mockResolvedValue({data:rows(),error:null});state.auth.mockResolvedValue({supabase:{rpc:state.rpc,from:()=>{const chain={select:()=>chain,eq:()=>chain,in:()=>chain,limit:()=>state.read()};return chain}}})});
it('reconciles three live center statements and rereads permissions, registry and source lines',async()=>{
 const r=await liveDimensionalStatements(query());expect(r.status).toBe('VERIFIED_DIMENSIONAL_STATEMENTS');expect(r.rows[0].statements.income.netProfit).toBe('-57.5000');expect(r.rows[0].statements.cash.opening).toBe('0.0000');expect(state.verify).toHaveBeenCalledTimes(2);expect(state.registry).toHaveBeenCalledTimes(2);expect(state.read).toHaveBeenCalledTimes(2);
});
it('rejects missing or foreign source dimensions',async()=>{
 state.read.mockResolvedValue({data:rows().slice(1),error:null});await expect(liveDimensionalStatements(query())).rejects.toThrow('REPORTING_DIMENSION_SOURCE_UNRESOLVED');
 state.read.mockResolvedValue({data:rows().map(r=>({...r,organization_id:'other'})),error:null});await expect(liveDimensionalStatements(query())).rejects.toThrow('REPORTING_DIMENSION_SOURCE_UNRESOLVED');
});
it('rejects changes to approved registry while compiling',async()=>{
 state.registry.mockResolvedValueOnce(registry()).mockResolvedValue({...registry(),revision:'2'});
 await expect(liveDimensionalStatements(query())).rejects.toThrow('REPORTING_SOURCE_CHANGED_DURING_VERIFICATION');
});
it('rejects revoked source access and unavailable closed-year dimensions',async()=>{
 state.verify.mockRejectedValueOnce(Error('REPORTING_ACCESS_DENIED'));await expect(liveDimensionalStatements(query())).rejects.toThrow('REPORTING_ACCESS_DENIED');
 state.rpc.mockResolvedValue({data:{...raw(),closureId:'closed'},error:null});await expect(liveDimensionalStatements(query())).rejects.toThrow('REPORTING_CLOSED_DIMENSIONS_UNAVAILABLE');
});
