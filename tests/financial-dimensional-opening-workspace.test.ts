vi.mock('../services/financial-center-branch-registry',()=>({centerBranchRegistry:async()=>({assignments:[{centerId:'branch-1',branchId:null,status:'APPROVED',from:'2026-01-01',to:null}]})}));
import {beforeEach,describe,expect,it,vi} from 'vitest';
const org='10000000-0000-4000-8000-000000000001';
const opening='20000000-0000-4000-8000-000000000002';
const id='30000000-0000-4000-8000-000000000003';
const state=vi.hoisted(()=>({authenticated:true,enabled:true,member:true,authorized:true,revoked:false,authChecks:0,error:null as string|null,queries:[] as {name:string;args:any}[]}));
vi.mock('../services/auth',()=>({requireUser:async()=>{if(!state.authenticated)throw Error('UNAUTHORIZED');return{
 supabase:{
 rpc:async(name:string,args:any)=>{state.queries.push({name,args});return{
  data:name==='financial_core_can'?state.authorized:name==='financial_dimensional_opening_context'?{status:'DRAFT',id,organizationId:org,fiscalStart:'2026-01-01',version:3}:{status:'DRAFT',id:'demo'},
  error:state.error?{message:state.error}:null,
 }},
 from(table:string){
  const chain={
   select(){return chain},eq(){return chain},
   async maybeSingle(){if(table==='organization_members'){
    state.authChecks++;
    return{data:state.member&&!(state.revoked&&state.authChecks>1)?{organization_id:org}:null,error:null};
   }
   return{data:{id:opening,organization_id:org,fiscal_start:'2026-01-01',currency:'SAR',
    status:'APPROVED',version:2,approved_opening:[{itemId:'bank',accountCode:'1000',debit:'100.0000',credit:'0.0000'}]},error:null}
   },
   async limit(){return{data:[{id:'branch-1',organization_id:org,name:'Branch 1',entity_type:'BRANCH',active:true}],error:null}},
  };return chain;
 },
 },user:{id:'owner'},
}}}));
vi.mock('../services/financial-opening-workspace',()=>({assertOpeningWorkspace:()=>{if(!state.enabled)throw Error('OPENING_DISABLED')}}));
import {dimensionalOpeningContext,dimensionalOpeningCommand,dimensionalOpeningEditorContext} from '../services/financial-dimensional-opening-workspace';
beforeEach(()=>Object.assign(state,{authenticated:true,enabled:true,member:true,authorized:true,revoked:false,authChecks:0,error:null,queries:[]}));
const good={action:'save' as const,organization:org,fiscalStart:'2026-01-01',expectedVersion:0,
 openingWorkspace:opening,openingVersion:2,reason:'Attribution evidence',
 entries:{bank:[{branchId:null,centerId:null,debit:'100.0000',credit:'0.0000'}]}};
describe('authenticated opening distribution adapter',()=>{
 it('passes only validated opening data to scoped RLS financial RPCs',async()=>{
  const result=await dimensionalOpeningCommand(good);
  expect(result).toMatchObject({status:'DRAFT'});
  expect(state.queries).toEqual([{name:'save_financial_dimensional_opening',args:{
   p_org:org,p_fiscal_start:'2026-01-01',p_expected_version:0,
   p_opening_workspace:opening,p_opening_version:2,
   p_entries:good.entries,p_reason:'Attribution evidence',
  }}]);
 });
 it('validates journal-independent opening dimensions and approval request',async()=>{
  await expect(dimensionalOpeningCommand({...good,entries:{bank:[{branchId:'wrong',debit:'0',credit:'0'}]}})).rejects.toThrow();
  await expect(dimensionalOpeningCommand({...good,extra:'unrecognized'})).rejects.toThrow();
  await expect(dimensionalOpeningCommand({...good,entries:{bank:[{branchId:null,centerId:'foreign-format',debit:'100',credit:'0'}]}})).rejects.toThrow();
  await expect(dimensionalOpeningCommand({...good,entries:{bank:[{branchId:null,debit:'100',credit:'0'}]}})).rejects.toThrow();
  await expect(dimensionalOpeningCommand({action:'approve',id,expectedVersion:3})).rejects.toThrow();
  expect(state.queries).toEqual([]);
 });
 it('read calls scoped context and denies anonymous or disabled access',async()=>{
  await dimensionalOpeningContext({organization:org,fiscalStart:'2026-01-01'});
  expect(state.queries[0]).toMatchObject({name:'financial_dimensional_opening_context',args:{p_org:org}});
  state.authenticated=false;
  await expect(dimensionalOpeningContext({organization:org,fiscalStart:'2026-01-01'})).rejects.toThrow('UNAUTHORIZED');
  state.enabled=false;await expect(dimensionalOpeningCommand(good)).rejects.toThrow('OPENING_DISABLED');
 });
 it('verifies the saved draft belongs to the selected organization and fiscal year before approving',async()=>{
  const selected={action:'approve',id,expectedVersion:3,scope:{organization:org,fiscalStart:'2026-01-01'}};
  await expect(dimensionalOpeningCommand({...selected,id:opening})).rejects.toThrow('DIMENSION_OPENING_APPROVE_DENIED');
  await expect(dimensionalOpeningCommand({...selected,scope:{...selected.scope,organization:'10000000-0000-4000-8000-000000000009'}})).rejects.toThrow('DIMENSION_OPENING_APPROVE_DENIED');
  await expect(dimensionalOpeningCommand({...selected,scope:{...selected.scope,fiscalStart:'2027-01-01'}})).rejects.toThrow('DIMENSION_OPENING_APPROVE_DENIED');
  await expect(dimensionalOpeningCommand({...selected,expectedVersion:2})).rejects.toThrow('DIMENSION_OPENING_VERSION_CONFLICT');
  expect(state.queries.map(q=>q.name)).toEqual(Array(4).fill('financial_dimensional_opening_context'));
  await dimensionalOpeningCommand(selected);
  expect(state.queries.at(-1)).toEqual({name:'approve_financial_dimensional_opening',args:{p_distribution:id,p_expected_version:3}});
 });
 it('redacts database errors while preserving safe known codes',async()=>{
  state.error='DIMENSION_OPENING_SOURCE_CHANGED some internal query';
  await expect(dimensionalOpeningCommand(good)).rejects.toThrow('DIMENSION_OPENING_SOURCE_CHANGED');
  state.error='Postgres private SQL secrets';
  await expect(dimensionalOpeningCommand(good)).rejects.toThrow('DIMENSION_OPENING_UNAVAILABLE');
 });

});

it('offers dated center assignments beside the exact approved opening',async()=>{
 const r=await dimensionalOpeningEditorContext({organization:org,fiscalStart:'2026-01-01'});
 expect(r.centers).toEqual([{id:'branch-1',name:'Branch 1',branchId:null}]);expect(r.opening?.id).toBe(opening);
 state.revoked=true;state.authChecks=0;await expect(dimensionalOpeningEditorContext({organization:org,fiscalStart:'2026-01-01'})).rejects.toThrow('BRANCH_OPENING_READ_DENIED');
});
