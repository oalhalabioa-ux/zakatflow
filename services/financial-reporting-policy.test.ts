import {beforeEach,describe,it,expect,vi} from 'vitest';
const f=vi.hoisted(()=>({rpc:vi.fn(),from:vi.fn(),requireUser:vi.fn(),insert:vi.fn(),policy:null as null|{status:string;version:number;rules:unknown[]},classifications:[] as Record<string,unknown>[],canSave:true,canSeed:true,saveError:null as null|{message:string}}));
vi.mock('./auth',()=>({requireUser:f.requireUser}));
vi.mock('./financial-statement-live',()=>({assertLiveStatements:vi.fn()}));
import {readReportingPolicy,writeReportingPolicy} from './financial-reporting-policy';
const org='11111111-1111-4111-8111-111111111111',scope={organization:org,fiscalStart:'2026-01-01'};
beforeEach(()=>{
 vi.clearAllMocks();f.policy=null;f.classifications=[];f.canSave=true;f.canSeed=true;f.saveError=null;
 f.requireUser.mockResolvedValue({user:{id:'owner'},supabase:{rpc:f.rpc,from:f.from}});
 f.rpc.mockImplementation(async(name,args)=>{
  if(name==='financial_reporting_policy_workspace')return {data:{organizationId:args.p_org,fiscalStart:args.p_fiscal_start,policy:f.policy,events:[],chart:['1000','1100','1400','1500','1590','1600','2100','2300','4100','6100','6200','8100'].map(code=>({id:code,code,cash:code==='1000'})),canSave:f.canSave,canApprove:true},error:null};
  if(name==='prepare_financial_account_rule_links')return {data:{addedRules:0},error:null};
  if(name==='effective_organization_permission')return {data:f.canSeed,error:null};
  if(name==='save_financial_reporting_policy'){
   if(f.saveError){f.policy={status:'DRAFT',version:1,rules:[{manual:'winner'}]};return {data:null,error:f.saveError};}
   f.policy={status:'DRAFT',version:1,rules:args.p_rules};return {data:f.policy,error:null};
  }
  throw Error('Unexpected RPC '+name);
 });
 f.from.mockImplementation(table=>{
  const chain={insert:f.insert.mockReturnThis(),single:vi.fn().mockResolvedValue({data:{id:'rent'},error:null}),select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),order:vi.fn().mockReturnThis(),limit:vi.fn().mockReturnThis(),
   then:(resolve:(x:unknown)=>unknown)=>Promise.resolve({data:table==='financial_classifications'?f.classifications:[],error:null}).then(resolve),
   upsert:vi.fn(async(rows:Record<string,unknown>[])=>{f.classifications=rows.map((r,i)=>({...r,id:'c'+i,active:true}));return {data:null,error:null};})};return chain;
 });
});
describe('authorized default posting initialization',()=>{
 it('keeps GET read-only and creates a persisted unapproved draft through POST without operations',async()=>{
  const read=await readReportingPolicy(scope);expect(read.defaults.rules).toEqual([]);expect(f.rpc.mock.calls.some(([n])=>n==='save_financial_reporting_policy')).toBe(false);
  const d=await writeReportingPolicy({action:'initialize-defaults',...scope});expect(d.policy?.status).toBe('DRAFT');expect(d.policy?.rules.length).toBeGreaterThan(0);
  expect(f.rpc).toHaveBeenCalledWith('save_financial_reporting_policy',expect.objectContaining({p_org:org,p_fiscal_start:'2026-01-01',p_expected_version:0}));
  expect(f.rpc.mock.calls.some(([n])=>n==='approve_financial_reporting_policy')).toBe(false);
  expect(f.from.mock.calls.filter(([t])=>t==='financial_classifications').length).toBeGreaterThan(0);
 });
 it('does not replace either a draft or an approved policy, including an intentionally empty policy',async()=>{
  for(const status of ['DRAFT','APPROVED']){f.policy={status,version:7,rules:[]};const r=await writeReportingPolicy({action:'initialize-defaults',...scope});expect(r.policy).toEqual(f.policy);}
  expect(f.rpc.mock.calls.some(([n])=>n==='save_financial_reporting_policy')).toBe(false);
 });
 it('denies a viewer before any classification or policy write',async()=>{
  f.canSave=false;await expect(writeReportingPolicy({action:'initialize-defaults',...scope})).rejects.toThrow('REPORTING_ACCESS_DENIED');
  expect(f.rpc.mock.calls.some(([n])=>n==='save_financial_reporting_policy')).toBe(false);expect(f.classifications).toEqual([]);
 });
 it('recovers an empty approved policy into an unapproved draft without updating or approving the original',async()=>{
  const approved={status:'APPROVED',version:2,rules:[]};f.policy=approved;
  const r=await writeReportingPolicy({action:'initialize-defaults',...scope,repairEmpty:true});
  expect(r.policy?.status).toBe('DRAFT');expect(r.policy?.rules).toHaveLength(39);
  expect(approved).toEqual({status:'APPROVED',version:2,rules:[]});
  expect(f.rpc).toHaveBeenCalledWith('save_financial_reporting_policy',expect.objectContaining({p_expected_version:0}));
  expect(f.rpc.mock.calls.some(([n])=>n==='approve_financial_reporting_policy')).toBe(false);
 });
 it('explicit empty-draft recovery uses its version and never replaces populated drafts or approved policies',async()=>{
  f.policy={status:'DRAFT',version:7,rules:[]};
  await writeReportingPolicy({action:'initialize-defaults',...scope,repairEmpty:true});
  expect(f.rpc).toHaveBeenCalledWith('save_financial_reporting_policy',expect.objectContaining({p_expected_version:7}));
  f.rpc.mockClear();
  for(const status of ['DRAFT','APPROVED']){const original={status,version:8,rules:[{manual:'keep'}]};f.policy=original;const r=await writeReportingPolicy({action:'initialize-defaults',...scope,repairEmpty:true});expect(r.policy).toEqual(original);}
  expect(f.rpc.mock.calls.some(([n])=>n==='save_financial_reporting_policy')).toBe(false);
 });
 it('does not grant classification creation to a financial-only editor',async()=>{
  f.canSeed=false;await expect(writeReportingPolicy({action:'initialize-defaults',...scope})).rejects.toThrow('REPORTING_CLASSIFICATIONS_REQUIRED');expect(f.classifications).toEqual([]);
 });
 it('converges to an existing concurrent draft without replacing its edits',async()=>{
  f.saveError={message:'REPORTING_VERSION_CONFLICT'};const r=await writeReportingPolicy({action:'initialize-defaults',...scope});expect(r.policy?.rules).toEqual([{manual:'winner'}]);
 });
 it('rejects client-supplied default mappings and checks scope before any write',async()=>{
  await expect(writeReportingPolicy({action:'initialize-defaults',...scope,rules:[]})).rejects.toThrow();expect(f.rpc).not.toHaveBeenCalled();
 });
});

describe('operating expense classification management',()=>{
 const command={action:'create-expense-classification',...scope,code:'OPEX_RENT',name:'إيجار المكتب'};
 it('inserts only a scoped operating expense classification without saving or approving rules',async()=>{
  await expect(writeReportingPolicy(command)).resolves.toEqual({id:'rent'});
  expect(f.insert).toHaveBeenCalledWith({organization_id:org,code:'OPEX_RENT',name:'إيجار المكتب',
   classification_type:'OPEX',is_system:false,created_by:'owner'});
  expect(f.rpc.mock.calls.some(([name])=>name==='save_financial_reporting_policy')).toBe(false);
 });
 it('denies classification writes without organization editing rights',async()=>{
  f.canSeed=false;
  await expect(writeReportingPolicy(command)).rejects.toThrow('REPORTING_ACCESS_DENIED');
  expect(f.insert).not.toHaveBeenCalled();
 });
});


describe('batch default activation',()=>{
 it('requires approval rights before provisioning or writing',async()=>{
  f.canSave=false;
  await expect(writeReportingPolicy({action:'activate-defaults',...scope})).rejects.toThrow('REPORTING_APPROVE_DENIED');
  expect(f.rpc.mock.calls.some(([n])=>n==='prepare_financial_posting_defaults')).toBe(false);
 });
 it('rejects browser-supplied mappings on the automatic endpoint',async()=>{
  await expect(writeReportingPolicy({action:'activate-defaults',...scope,rules:[]})).rejects.toThrow();
  expect(f.rpc).not.toHaveBeenCalled();
 });
 it('does not activate when an existing bank cannot be linked',async()=>{
  const original=f.rpc.getMockImplementation()!;
  f.rpc.mockImplementation(async(name,args)=>{
   if(name==='prepare_financial_posting_defaults')return {data:{},error:null};
   if(name==='link_financial_cash_accounts')return {data:null,error:{message:'FISCAL_CASH_LINK_INVALID'}};
   return original(name,args);
  });
  await expect(writeReportingPolicy({action:'activate-defaults',...scope})).rejects.toThrow('REPORTING_UNAVAILABLE');
  expect(f.rpc.mock.calls.some(([name])=>name==='activate_financial_posting_defaults')).toBe(false);
 });
 it('provisions tenant roles and delegates batch save/approval to the atomic RPC',async()=>{
  const original=f.rpc.getMockImplementation()!;
  const roots=['1000','1100','1200','1300','1400','1500','1590','1600','2100','2200','2300','2400','4100','6100','6200','7100','8100'];
  const roles=Object.fromEntries(roots.filter(r=>r!=='1000').map(r=>[r,r+'01']));
  f.rpc.mockImplementation(async(name,args)=>{
   if(name==='prepare_financial_posting_defaults')return {data:roles,error:null};
   if(name==='link_financial_cash_accounts')return {data:{},error:null};
   if(name==='activate_financial_posting_defaults')return {data:{status:'APPROVED'},error:null};
   const result=await original(name,args);
   if(name==='financial_reporting_policy_workspace')result.data.chart=roots.flatMap(code=>[{id:code,code,reportingCode:code,cash:code==='1000'},...(code==='1000'?[]:[{id:code+'01',code:code+'01',reportingCode:code,cash:false}])]);
   return result;
  });
  await writeReportingPolicy({action:'activate-defaults',...scope});
  expect(f.rpc).toHaveBeenCalledWith('link_financial_cash_accounts',{p_org:org});
  const calls=f.rpc.mock.calls.map(([name])=>name);
  expect(calls.indexOf('link_financial_cash_accounts')).toBeLessThan(calls.indexOf('activate_financial_posting_defaults'));
  expect(calls.indexOf('save_financial_reporting_policy')).toBeLessThan(calls.lastIndexOf('prepare_financial_account_rule_links'));
  expect(calls.lastIndexOf('prepare_financial_account_rule_links')).toBeLessThan(calls.indexOf('activate_financial_posting_defaults'));
  expect(f.rpc).toHaveBeenCalledWith('activate_financial_posting_defaults',expect.objectContaining({p_org:org,p_fiscal_start:scope.fiscalStart,p_policy_id:null,p_expected_version:1,p_rules:expect.arrayContaining([expect.objectContaining({detailed:true,debitAccountId:'110001',creditAccountId:'410001'})])}));
  expect(f.rpc.mock.calls.some(([n])=>n==='approve_financial_reporting_policy')).toBe(false);
 });
});
