import {beforeEach,describe,expect,it,vi} from 'vitest';

const state=vi.hoisted(()=>({
 orgs:[{id:'parent',name:'Parent',base_currency:'SAR',currentFiscalStart:'2026-01-01'},
  {id:'subsidiary',name:'Subsidiary',base_currency:'SAR',currentFiscalStart:'2026-01-01'},
  {id:'external-child',name:'External child',base_currency:'SAR',currentFiscalStart:'2026-01-01'}],
 relations:[{id:'parent',parent_organization_id:null},{id:'subsidiary',parent_organization_id:'parent'},
  {id:'external-child',parent_organization_id:'not-authorized'}],
 queriedIds:[] as string[],
}));
vi.mock('../services/auth',()=>({requireUser:async()=>({supabase:{
 rpc:async()=>({data:[],error:null}),
 from:(table:string)=>({select:(fields:string)=>({in:async(_key:string,ids:string[])=>{
  if(table!=='organizations'||fields!=='id,parent_organization_id')throw Error('UNEXPECTED_SOURCE');
  state.queriedIds=ids;return{data:state.relations,error:null};
 }})}),
}})}));
vi.mock('../services/financial-opening-workspace',()=>({assertOpeningWorkspace:()=>{},openingContext:async()=>state.orgs}));
import {liveStatementContext} from '../services/financial-statement-live';

beforeEach(()=>{vi.stubEnv('FINANCIAL_STATEMENTS_LIVE','true');state.queriedIds=[]});

describe('financial statement topbar hierarchy',()=>{
 it('exposes only authorized parent links for the familiar company/group selector',async()=>{
  const results=await liveStatementContext();
  expect(state.queriedIds).toEqual(['parent','subsidiary','external-child']);
  expect(results).toMatchObject([
   {organizationId:'parent',parentOrganizationId:null},
   {organizationId:'subsidiary',parentOrganizationId:'parent'},
   {organizationId:'external-child',parentOrganizationId:null},
  ]);
  expect(JSON.stringify(results)).not.toContain('not-authorized');
 });
 it('does not query hierarchy when no organization is accessible',async()=>{
  const existing=state.orgs;state.orgs=[];
  try{expect(await liveStatementContext()).toEqual([]);expect(state.queriedIds).toEqual([])}
  finally{state.orgs=existing}
 });
});
