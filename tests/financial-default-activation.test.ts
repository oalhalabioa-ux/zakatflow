import {beforeEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({policy:null as any,classes:[] as any[],calls:[] as string[],failSync:false,canApprove:true}));
vi.mock('../services/financial-statement-live',()=>({assertLiveStatements:()=>{}}));
vi.mock('../services/auth',()=>({requireUser:async()=>({user:{id:'actor'},supabase:client})}));
import {writeReportingPolicy} from '../services/financial-reporting-policy';
import {POSTING_BASE_CLASSIFICATIONS} from '../lib/financial-default-posting-rules';
const organization='10000000-0000-4000-8000-000000000001',fiscalStart='2026-01-01';
const roots=['1000','1100','1200','1300','1400','1500','1590','1600','1700','1800','2100','2200','2300','2400','2500','3100','3200','3300','4100','5100','6100','6200','7100','8100'];
const chart=roots.flatMap(code=>[{id:code,code,cash:code==='1000',reportingCode:code},{id:code+'01',code:code+'01',cash:code==='1000',reportingCode:code}]).concat([{id:'410002',code:'410002',cash:false,reportingCode:'4100'},{id:'160002',code:'160002',cash:false,reportingCode:'1600'}]);
const client={
 from(table:string){const result={data:table==='financial_classifications'?state.classes:table==='financial_posting_account_roles'?roots.map(role=>({role,account_code:role==='1000'?role:role+'01'})):[],error:null};const chain:any={select:()=>chain,eq:()=>chain,order:()=>chain,limit:()=>chain,then:(resolve:any)=>Promise.resolve(result).then(resolve)};return chain;},
 async rpc(name:string,args:any){state.calls.push(name);let data:any=null;
  if(name==='financial_reporting_policy_workspace')data={organizationId:organization,fiscalStart,chart,policy:state.policy,events:[],canSave:true,canApprove:state.canApprove};
  if(name==='prepare_financial_posting_defaults')data=Object.fromEntries(roots.map(r=>[r,r==='1000'?r:r+'01']));
  if(name==='save_financial_reporting_policy')state.policy={id:'policy',version:1,status:'DRAFT',rules:args.p_rules};
  if(name==='prepare_financial_account_rule_links'&&state.policy){
   if(state.failSync)return {data:null,error:{message:'REPORTING_VERSION_CONFLICT'}};
   if(!state.classes.some(c=>c.id==='investment-child'))state.classes.push({id:'investment-child',code:'INVESTMENT_ACCOUNT_160002',name:'Investment detail',classification_type:'INVESTMENT',active:true,is_system:true,metadata:{accountInheritance:{accountCode:'160002',reportingCode:'1600',baseClassificationId:'INVESTMENT',classificationId:'investment-child'}}});
  }
  if(name==='activate_financial_posting_defaults')state.policy={...state.policy,status:'APPROVED',rules:args.p_rules};
  return {data,error:null};
 }
};
beforeEach(()=>{state.policy=null;state.calls=[];state.failSync=false;state.canApprove=true;state.classes=POSTING_BASE_CLASSIFICATIONS.map(([code,name])=>({id:code,code,name,classification_type:code,active:true,is_system:false}));});
it('activates child mappings whose templates did not exist before preparation',async()=>{
 const result=await writeReportingPolicy({action:'activate-defaults',organization,fiscalStart});
 expect(result.policy.status).toBe('APPROVED');
 expect(result.policy.rules.some((r:any)=>r.classificationId.startsWith('investment-child:')&&r.debitAccountId==='160002')).toBe(true);
 expect(result.accountLinkCoverage.find((a:any)=>a.accountCode==='160002')?.status).toBe('LINKED');
});
it('does not approve a partially prepared policy when inheritance fails',async()=>{
 state.failSync=true;
 await expect(writeReportingPolicy({action:'activate-defaults',organization,fiscalStart})).rejects.toThrow('REPORTING_VERSION_CONFLICT');
 expect(state.policy.status).toBe('DRAFT');
 expect(state.calls).not.toContain('activate_financial_posting_defaults');
});
it('denies batch activation before any preparation when approval permission is absent',async()=>{
 state.canApprove=false;
 await expect(writeReportingPolicy({action:'activate-defaults',organization,fiscalStart})).rejects.toThrow('REPORTING_APPROVE_DENIED');
 expect(state.calls).not.toContain('prepare_financial_posting_defaults');
});
it('repeated activation preserves an explicit detail edit without duplicating rules',async()=>{
 await writeReportingPolicy({action:'activate-defaults',organization,fiscalStart});
 const target=state.policy.rules.find((r:any)=>r.classificationId==='REVENUE:BASE'&&r.eventType==='REVENUE'&&r.sourceModule==='OPERATIONAL_CONSOLE');
 target.creditAccountId='410002';
 const before=state.policy.rules.length;
 const again=await writeReportingPolicy({action:'activate-defaults',organization,fiscalStart});
 expect(again.policy.rules.length).toBe(before);
 expect(again.policy.rules.find((r:any)=>r.classificationId===target.classificationId&&r.eventType===target.eventType&&r.sourceModule===target.sourceModule)?.creditAccountId).toBe('410002');
});
