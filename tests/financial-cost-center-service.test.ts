import {compileBranchReport} from '../lib/financial-branch-report';
import {beforeEach,describe,it,expect,vi} from 'vitest';
import {branchFixture} from './financial-reporting/branch-report-fixture';
import {normalizeStatementSource} from '../lib/financial-statement-source';
const state=vi.hoisted(()=>({branch:vi.fn(),rpc:vi.fn(),verify:vi.fn(),auth:vi.fn(),gate:vi.fn(),read:vi.fn()}));
vi.mock('../services/auth',()=>({requireUser:()=>state.auth()}));
vi.mock('../services/financial-statement-live',()=>({assertLiveStatements:()=>state.gate(),liveStatementSource:(q:unknown)=>state.verify(q)}));
vi.mock('../services/financial-branch-report',()=>({liveBranchReport:(...args:unknown[])=>state.branch(...args)}));
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

it('intersects persisted original center lines with the verified branch source, including headquarters',async()=>{
 const fixture=branchFixture(),branch='20000000-0000-4000-8000-000000000002';
 for(const selected of [branch,'HQ']){
  const selectedId=selected==='HQ'?null:selected;
  const ids=new Set(fixture.journalEvidence.links.filter(l=>l.branchId===selectedId).map(l=>l.journalId));
  state.rpc.mockResolvedValue({data:fixture,error:null});
  state.branch.mockResolvedValue(compileBranchReport(fixture,query(),selectedId));
  state.read.mockImplementation(async(table:string)=>({data:table==='organization_cost_centers'?[{id:'center',organization_id:query().organization,name:'Center',active:true}]:rows().filter(l=>ids.has(l.event_id)),error:null}));
  const result=await liveCostCenterIncome(query(),selected);
  expect(result.branch).toBe(selected);
  expect(result.rows.find(r=>r.centerId==='center')?.income.netProfit).toBe(selected==='HQ'?'50.0000':'-107.5000');
  expect(state.branch).toHaveBeenLastCalledWith(query(),selected);
 }
});
it('does not substitute company results when branch source verification fails',async()=>{
 state.rpc.mockResolvedValue({data:branchFixture(),error:null});
 state.branch.mockRejectedValue(Error('REPORTING_ACCESS_DENIED'));
 await expect(liveCostCenterIncome(query(),'HQ')).rejects.toThrow('REPORTING_ACCESS_DENIED');
 await expect(liveCostCenterIncome(query(),'ALL')).rejects.toThrow();
});
