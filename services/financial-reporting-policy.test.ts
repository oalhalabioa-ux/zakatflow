import {beforeEach,describe,it,expect,vi} from 'vitest';
const f=vi.hoisted(()=>({rpc:vi.fn(),from:vi.fn(),requireUser:vi.fn(),policy:null as null|{status:string;version:number;rules:unknown[]},classifications:[] as Record<string,unknown>[],canSave:true,canSeed:true,saveError:null as null|{message:string}}));
vi.mock('./auth',()=>({requireUser:f.requireUser}));
vi.mock('./financial-statement-live',()=>({assertLiveStatements:vi.fn()}));
import {readReportingPolicy,writeReportingPolicy} from './financial-reporting-policy';
const org='11111111-1111-4111-8111-111111111111',scope={organization:org,fiscalStart:'2026-01-01'};
beforeEach(()=>{
 vi.clearAllMocks();f.policy=null;f.classifications=[];f.canSave=true;f.canSeed=true;f.saveError=null;
 f.requireUser.mockResolvedValue({user:{id:'owner'},supabase:{rpc:f.rpc,from:f.from}});
 f.rpc.mockImplementation(async(name,args)=>{
  if(name==='financial_reporting_policy_workspace')return {data:{organizationId:args.p_org,fiscalStart:args.p_fiscal_start,policy:f.policy,events:[],chart:['1000','1100','1400','1500','1600','2100','2300','4100','6100','8100'].map(code=>({id:code,code,cash:code==='1000'})),canSave:f.canSave},error:null};
  if(name==='effective_organization_permission')return {data:f.canSeed,error:null};
  if(name==='save_financial_reporting_policy'){
   if(f.saveError){f.policy={status:'DRAFT',version:1,rules:[{manual:'winner'}]};return {data:null,error:f.saveError};}
   f.policy={status:'DRAFT',version:1,rules:args.p_rules};return {data:f.policy,error:null};
  }
  throw Error('Unexpected RPC '+name);
 });
 f.from.mockImplementation(table=>{
  const chain={select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),order:vi.fn().mockReturnThis(),limit:vi.fn().mockReturnThis(),
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
