import {beforeEach,it,expect,vi} from 'vitest';
import {sourceBoundGroupFixture} from './financial-reporting/group-source-bound-fixture';
import {openItemFixture} from './financial-reporting/group-open-item-fixture';
const state=vi.hoisted(()=>({rpc:vi.fn(),from:vi.fn(),reads:[] as string[],truncate:false,deny:false}));
vi.mock('../services/auth',()=>({requireUser:async()=>({user:{id:'actor'},supabase:{rpc:state.rpc,from:state.from}})}));
import {readGroupOpenItems} from '../services/financial-group-open-items';
const f=sourceBoundGroupFixture(),evidence=openItemFixture(f.entry);
beforeEach(()=>{
 vi.resetAllMocks();state.reads=[];state.truncate=false;state.deny=false;state.rpc.mockResolvedValue({data:true,error:null});
 const tables:Record<string,Record<string,unknown>[]>={financial_event_obligations:evidence.flatMap(s=>s.roots),financial_event_obligation_allocations:[],financial_event_links:[],financial_events:evidence.flatMap(s=>s.events)};
 state.from.mockImplementation((table:string)=>{
  let filters:((r:Record<string,unknown>)=>boolean)[]=[],start=0,end=499;
  const chain={select:(columns:string)=>{state.reads.push(columns);return chain},eq:(key:string,v:unknown)=>{filters.push(r=>r[key]===v);return chain},in:(key:string,values:unknown[])=>{filters.push(r=>values.includes(r[key]));return chain},is:(key:string,v:unknown)=>{filters.push(r=>r[key]===v);return chain},order:()=>chain,range:(a:number,b:number)=>{start=a;end=b;return chain},maybeSingle:async()=>({data:state.deny?null:{organization_id:'member'},error:null}),then:(resolve:(r:unknown)=>unknown)=>{const rows=(tables[table]??[]).filter(r=>filters.every(fn=>fn(r)));return Promise.resolve({data:state.truncate?[]:rows.slice(start,end+1),count:rows.length,error:null}).then(resolve)}};
  return chain;
 });
});
it('reads exact decimal text under organization filters and rechecks authorization',async()=>{const r=await readGroupOpenItems([f.entry]);expect(r).toEqual(evidence);expect(state.rpc).toHaveBeenCalledTimes(4);expect(state.reads.some(s=>s.includes('settleable_base_amount::text'))).toBe(true);expect(state.reads.some(s=>s.includes('base_amount::text'))).toBe(true)});
it('fails closed when counts reveal a hidden or truncated page',async()=>{state.truncate=true;await expect(readGroupOpenItems([f.entry])).rejects.toThrow('REPORTING_GROUP_OPEN_ITEMS_UNAVAILABLE')});
it('does not load financial tables after membership denial',async()=>{state.deny=true;await expect(readGroupOpenItems([f.entry])).rejects.toThrow('REPORTING_ACCESS_DENIED');expect(state.from).toHaveBeenCalledTimes(1)});
it('rejects revocation at the final permission check',async()=>{state.rpc.mockResolvedValueOnce({data:true,error:null}).mockResolvedValue({data:false,error:null});await expect(readGroupOpenItems([f.entry])).rejects.toThrow('REPORTING_ACCESS_DENIED')});
it('does not infer open receivables from an income elimination',async()=>{expect(await readGroupOpenItems([{...f.entry,kind:'INTERCOMPANY_INCOME'}])).toEqual([]);expect(state.from).not.toHaveBeenCalled()});
