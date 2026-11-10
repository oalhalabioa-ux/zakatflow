import {beforeEach,describe,it,expect,vi} from 'vitest';
import {branchFixture} from './financial-reporting/branch-report-fixture';
import {normalizeStatementSource} from '../lib/financial-statement-source';
const state=vi.hoisted(()=>({rpc:vi.fn(),verify:vi.fn(),auth:vi.fn(),gate:vi.fn(),read:vi.fn()}));
vi.mock('../services/auth',()=>({requireUser:()=>state.auth()}));
vi.mock('../services/financial-statement-live',()=>({assertLiveStatements:()=>state.gate(),liveStatementSource:(q:unknown)=>state.verify(q)}));
import {liveCostCenterIncome} from '../services/financial-cost-center-income';
const raw=()=>branchFixture().source;
const query=()=>({organization:raw().organizationId,from:raw().from,to:raw().to});
function rows(){const p=raw();return [...new Map(p.events.flatMap(e=>e.lines.map(l=>{const id=l.id.split(':')[0];return [id,{id,event_id:e.id,organization_id:p.organizationId,cost_center_id:'center'}] as const}))).values()]}
beforeEach(()=>{vi.resetAllMocks();state.rpc.mockResolvedValue({data:raw(),error:null});state.verify.mockResolvedValue(normalizeStatementSource(raw(),query()));state.read.mockImplementation(async(table:string)=>({data:table==='organization_cost_centers'?[{id:'center',organization_id:query().organization,name:'Historic',active:false}]:rows(),error:null}));state.auth.mockResolvedValue({supabase:{rpc:state.rpc,from:(table:string)=>{const chain={select:()=>chain,eq:()=>chain,in:()=>chain,limit:()=>state.read(table)};return chain}},user:{id:'viewer'}})});
describe('live center attribution boundary',()=>{
 it('resolves VAT parts against the same original line and reauthorizes before returning',async()=>{const r=await liveCostCenterIncome(query());expect(r.rows.find(x=>x.centerId==='center')?.income.netProfit).toBe('-57.5000');expect(state.verify).toHaveBeenCalledTimes(2);expect(state.read).toHaveBeenCalledTimes(4)});
 it('refuses missing original lines and foreign organizations',async()=>{state.read.mockImplementation(async(table:string)=>({data:table==='organization_cost_centers'?[{id:'center',organization_id:query().organization,name:'Center',active:true}]:rows().slice(1),error:null}));await expect(liveCostCenterIncome(query())).rejects.toThrow('REPORTING_CENTER_SOURCE_UNRESOLVED');state.read.mockResolvedValue({data:[{id:'center',organization_id:'foreign'}],error:null});await expect(liveCostCenterIncome(query())).rejects.toThrow('REPORTING_CENTER_SOURCE_UNAVAILABLE')});
 it('rejects revoked access and dimensions changed during verification',async()=>{state.verify.mockRejectedValueOnce(Error('REPORTING_ACCESS_DENIED'));await expect(liveCostCenterIncome(query())).rejects.toThrow('REPORTING_ACCESS_DENIED');state.verify.mockResolvedValue(normalizeStatementSource(raw(),query()));let count=0;state.read.mockImplementation(async(table:string)=>({error:null,data:table==='organization_cost_centers'?[{id:'center',organization_id:query().organization,name:'Center',active:true}]:rows().map(r=>({...r,cost_center_id:++count>rows().length?null:'center'}))}));await expect(liveCostCenterIncome(query())).rejects.toThrow('REPORTING_SOURCE_CHANGED_DURING_VERIFICATION')});
});
