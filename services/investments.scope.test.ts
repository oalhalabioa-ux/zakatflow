import {beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({requireUser:vi.fn(),rpc:vi.fn()}));
vi.mock('./auth',()=>({requireUser:mocks.requireUser}));
import {investmentWorkspace,investmentAction} from './investments';
const actor='10000000-0000-4000-8000-000000000001';
const other='10000000-0000-4000-8000-000000000002';
const org='20000000-0000-4000-8000-000000000001';
const child='20000000-0000-4000-8000-000000000002';
const foreign='20000000-0000-4000-8000-000000000003';
const contractId='30000000-0000-4000-8000-000000000001';
const bank='40000000-0000-4000-8000-000000000001';
const requestId='50000000-0000-4000-8000-000000000001';
let fixtures:Record<string,any[]>;
let failed:Set<string>;
let readTables:string[];
function query(table:string){
 readTables.push(table);
 let filters:Array<(row:any)=>boolean>=[],single=false,range:[number,number]|null=null;
 const q:any={
  select:()=>q,order:()=>q,
  eq:(key:string,value:unknown)=>{filters.push(row=>row[key]===value);return q},
  is:(key:string,value:unknown)=>{filters.push(row=>value===null?row[key]==null:row[key]===value);return q},
  in:(key:string,values:unknown[])=>{filters.push(row=>values.includes(row[key]));return q},
  single:()=>{single=true;return q},maybeSingle:()=>{single=true;return q},
  range:(start:number,end:number)=>{range=[start,end];return q},
  then:(resolve:any,reject:any)=>{
   let data=(fixtures[table]??[]).filter(row=>filters.every(filter=>filter(row)));
   if(range)data=data.slice(range[0],range[1]+1);
   return Promise.resolve({data:single?data[0]??null:data,error:failed.has(table)?new Error('UNRELATED_SCOPE_UNAVAILABLE'):null}).then(resolve,reject);
  }
 };
 return q;
}
const terms=(organization:string|null=null)=>({name:'Deposit',instrument:'DEPOSIT',ownership_scope:organization?'ORGANIZATION':'PERSONAL',organization_id:organization,party_name:'Bank',currency:'SAR',principal:1000,face_value:1000,fees:0,annual_rate:5,start_date:'2026-01-01',maturity_date:'2027-01-01',interest_basis:'ACT_365',zakat_basis:'HIJRI_354',zakat_rate:0,zakat_base:1000,zakat_treatment:'INVESTOR',inflation_rate:0,fx_rate:1,funding_account_id:bank});
const personal={scope:'PERSONAL',organization_id:null,group:false};
const company={scope:'ORGANIZATION',organization_id:org,group:false};
beforeEach(()=>{
 vi.resetAllMocks();failed=new Set();readTables=[];
 fixtures={
  profiles:[{id:actor,base_currency:'SAR'}],
  organizations:[{id:org,name:'Parent',organization_kind:'HOLDING',base_currency:'USD'},{id:child,name:'Child',parent_organization_id:org},{id:foreign,name:'Other company'}],
  organization_members:[{organization_id:org,user_id:actor,status:'ACTIVE',role:'OWNER'},{organization_id:child,user_id:actor,status:'ACTIVE',role:'VIEWER'}],
  investment_contracts:[{id:contractId,user_id:actor,organization_id:null,status:'ACTIVE',terms:terms()}],
  investment_operations:[],
  asset_accounts:[{id:bank,user_id:actor,name:'Personal bank',organization_id:null,ownership_scope:'PERSONAL',asset_type:'BANK',status:'ACTIVE',currency:'SAR'}],
  liquidity_accounts:[{id:'org-bank',organization_id:org,active:true,account_type:'BANK',currency:'SAR'},{id:'child-bank',organization_id:child,active:true,account_type:'BANK',currency:'SAR'},{id:'foreign-bank',organization_id:foreign,active:true,account_type:'BANK',currency:'SAR'}],
 };
 mocks.rpc.mockResolvedValue({data:{id:contractId},error:null});
 mocks.requireUser.mockResolvedValue({user:{id:actor},supabase:{from:query,rpc:mocks.rpc}});
});
it('opens personal investments even when an unrelated company contract is invalid and corporate accounts are unavailable',async()=>{
 fixtures.investment_contracts.push({id:'company-invalid',user_id:actor,organization_id:org,terms:{name:'Incomplete corporate contract'}},{id:'another-person',user_id:other,organization_id:null,terms:{name:'Not this user'}});
 fixtures.investment_operations=[{id:'p-op',contract_id:contractId,user_id:actor,organization_id:null},{id:'org-op',contract_id:'company-invalid',user_id:actor,organization_id:org},{id:'other-op',contract_id:contractId,user_id:other,organization_id:null}];
 fixtures.asset_accounts.push({id:'inactive',user_id:actor,ownership_scope:'PERSONAL',organization_id:null,asset_type:'BANK',status:'INACTIVE'});
 failed.add('liquidity_accounts');
 const result=await investmentWorkspace(personal);
 expect(result.contracts.map((row:any)=>row.id)).toEqual([contractId]);
 expect(result.contracts[0].projection.coupon).toBe(50);
 expect(result.operations.map((row:any)=>row.id)).toEqual(['p-op']);
 expect(result.personalAccounts.map((row:any)=>row.id)).toEqual([bank]);
 expect(result.organizationAccounts).toEqual([]);
 expect(readTables).not.toContain('liquidity_accounts');
});
it('loads only the selected company and does not depend on personal contracts or accounts',async()=>{
 fixtures.investment_contracts.push({id:'company',user_id:actor,organization_id:org,terms:terms(org)},{id:'subsidiary',user_id:other,organization_id:child,terms:terms(child)},{id:'foreign-invalid',user_id:actor,organization_id:foreign,terms:{}});
 failed.add('personal_contracts');failed.add('asset_accounts');failed.add('profiles');
 const result=await investmentWorkspace(company);
 expect(result.contracts.map((row:any)=>row.id)).toEqual(['company']);
 expect(result.organizationAccounts.map((row:any)=>row.id)).toEqual(['org-bank']);
 expect(result.personalAccounts).toEqual([]);expect(result.personalParticipations).toEqual([]);expect(result.baseCurrency).toBe('USD');
 expect(readTables).not.toContain('personal_contracts');expect(readTables).not.toContain('asset_accounts');expect(readTables).not.toContain('profiles');
});
it('includes authorized descendants only when group was explicitly selected',async()=>{
 fixtures.investment_contracts=[{id:'parent',user_id:actor,organization_id:org,terms:terms(org)},{id:'child',user_id:other,organization_id:child,terms:terms(child)},{id:'foreign',user_id:actor,organization_id:foreign,terms:{}}];
 const result=await investmentWorkspace({...company,group:true});
 expect(result.contracts.map((row:any)=>row.id)).toEqual(['parent','child']);
 expect(result.organizationAccounts.map((row:any)=>row.id)).toEqual(['org-bank','child-bank']);
 fixtures.organization_members[1].status='INACTIVE';
 await expect(investmentWorkspace({...company,group:true})).rejects.toThrow('ORGANIZATION_ACCESS_REQUIRED');
});
it('rejects unavailable organization and mixed personal/company request contexts before loading contracts',async()=>{
 await expect(investmentWorkspace({...company,organization_id:foreign})).rejects.toThrow('ORGANIZATION_ACCESS_REQUIRED');
 await expect(investmentWorkspace({...personal,organization_id:org})).rejects.toThrow('INVESTMENT_SCOPE_INVALID');
 await expect(investmentWorkspace({...personal,group:true})).rejects.toThrow('INVESTMENT_SCOPE_INVALID');
 await expect(investmentWorkspace({...company,organization_id:null})).rejects.toThrow('INVESTMENT_SCOPE_INVALID');
 expect(readTables).not.toContain('investment_contracts');
});
it('fails closed if stored ownership terms do not match the selected record owner',async()=>{
 fixtures.investment_contracts[0].terms=terms(org);
 await expect(investmentWorkspace(personal)).rejects.toThrow('INVESTMENT_SCOPE_MISMATCH');
});
it('rejects creating or editing a contract outside the banner context without invoking the accounting command',async()=>{
 await expect(investmentAction({action:'SAVE',workspace:personal,request_id:requestId,payload:terms(org)})).rejects.toThrow('INVESTMENT_SCOPE_MISMATCH');
 await expect(investmentAction({action:'REPLACE',workspace:company,id:contractId,request_id:requestId,payload:terms(org)})).rejects.toThrow('INVESTMENT_ACCESS_DENIED');
 fixtures.investment_operations=[{id:requestId,contract_id:contractId,user_id:actor,organization_id:null}];
 await expect(investmentAction({action:'POST',workspace:company,id:requestId})).rejects.toThrow('INVESTMENT_ACCESS_DENIED');
 expect(mocks.rpc).not.toHaveBeenCalled();
});
it('passes authorized personal and selected-company drafts to the existing command unchanged',async()=>{
 await investmentAction({action:'SAVE',workspace:personal,request_id:requestId,payload:terms()});
 expect(mocks.rpc).toHaveBeenLastCalledWith('investment_command',{p_action:'SAVE',p_id:null,p_payload:expect.objectContaining(terms()),p_request_id:requestId});
 await investmentAction({action:'SAVE',workspace:company,request_id:requestId,payload:terms(org)});
 expect(mocks.rpc).toHaveBeenLastCalledWith('investment_command',{p_action:'SAVE',p_id:null,p_payload:expect.objectContaining(terms(org)),p_request_id:requestId});
});
it('preserves the owner of an existing subsidiary draft when revising from group view',async()=>{
 fixtures.investment_contracts[0]={id:contractId,user_id:other,organization_id:child,terms:terms(child)};
 await investmentAction({action:'REPLACE',workspace:{...company,group:true},id:contractId,request_id:requestId,payload:terms(child)});
 expect(mocks.rpc).toHaveBeenLastCalledWith('investment_command',expect.objectContaining({p_action:'REPLACE',p_id:contractId,p_payload:expect.objectContaining({organization_id:child})}));
 await expect(investmentAction({action:'REPLACE',workspace:{...company,group:true},id:contractId,request_id:requestId,payload:terms(org)})).rejects.toThrow('INVESTMENT_SCOPE_MISMATCH');
 expect(mocks.rpc).toHaveBeenCalledTimes(1);
});
