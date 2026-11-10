import {z} from 'zod';
import {readyPostingDefaults,type PostingAccountRoles} from '../lib/financial-ready-posting-defaults';
import {accountLinkCoverage} from '../lib/financial-account-link-coverage';
import {requireUser} from './auth';
import {assertLiveStatements} from './financial-statement-live';
import {openingScope} from '../lib/financial-opening-workspace';
import {validatePostingRuleAccounts,type PostingChartAccount} from '../lib/financial-posting-rule-validation';
import {defaultPostingRules,POSTING_BASE_CLASSIFICATIONS,type PostingClassification,type DefaultPostingAccount,type DefaultPostingRule} from '../lib/financial-default-posting-rules';
import type {RecognitionEvent} from '../lib/financial-event-ledger';
const text=z.string().min(1).max(300);
const rule=z.object({detailed:z.literal(true).optional(),eventType:text,sourceModule:text,classificationId:text,cashDirection:z.enum(['NON_CASH','INFLOW','OUTFLOW']),debitAccountId:text,creditAccountId:text,cashActivity:z.enum(['OPERATING','INVESTING','FINANCING']).optional()}).strict();
const command=z.discriminatedUnion('action',[
 z.object({action:z.literal('activate-defaults'),...openingScope.shape}).strict(),
 z.object({action:z.literal('create-expense-classification'),...openingScope.shape,
  code:z.string().trim().regex(/^OPEX_[A-Z0-9_]{1,45}$/),name:z.string().trim().min(1).max(160)}).strict(),
 z.object({action:z.literal('synchronize-accounts'),...openingScope.shape}).strict(),
 z.object({action:z.literal('initialize-defaults'),...openingScope.shape,repairEmpty:z.boolean().optional()}).strict(),
 z.object({action:z.literal('save'),...openingScope.shape,expectedVersion:z.number().int().min(0),rules:z.array(rule).max(5000),reason:z.string().trim().min(3).max(1000)}).strict(),
 z.object({action:z.literal('approve'),id:z.string().uuid(),expectedVersion:z.number().int().positive()}).strict(),
]);
function unwrap<T>(r:{data:T;error:{message:string}|null}){if(r.error)throw Error(r.error.message.match(/REPORTING_[A-Z_]+/)?.[0]??'REPORTING_UNAVAILABLE');return r.data}
export async function readReportingPolicy(input:unknown){
 assertLiveStatements();const q=openingScope.parse(input),{supabase}=await requireUser();
 const [workspace,approved]=await Promise.all([
  supabase.rpc('financial_reporting_policy_workspace',{p_org:q.organization,p_fiscal_start:q.fiscalStart}),
  supabase.from('financial_reporting_policies').select('status,version,rules,approved_at')
   .eq('organization_id',q.organization).eq('fiscal_start',q.fiscalStart)
   .eq('status','APPROVED').order('version',{ascending:false}).limit(1),
 ]);
 const result=unwrap(workspace) as {organizationId:string;fiscalStart:string;policy:{id:string;status:string;version:number;rules:DefaultPostingRule[]}|null;events:RecognitionEvent[];chart:DefaultPostingAccount[];canSave:boolean;canApprove:boolean};
 if(result.organizationId!==q.organization||result.fiscalStart!==q.fiscalStart)throw Error('REPORTING_SCOPE_INVALID');
 if(approved.error)throw Error('REPORTING_UNAVAILABLE');
 const classifications=unwrap(await supabase.from('financial_classifications').select('id,code,name,classification_type,active,is_system,metadata').eq('organization_id',q.organization).eq('active',true)) as PostingClassification[];
 const roleRows=unwrap(await supabase.from('financial_posting_account_roles').select('role,account_code').eq('organization_id',q.organization)) as {role:string;account_code:string}[];
 const roles=Object.fromEntries(roleRows.map(r=>[r.role,r.account_code]));
 const defaults=defaultPostingRules(classifications,result.chart,result.events,result.policy?.rules??[],roles);
 return {...result,classifications,approvedPolicy:approved.data?.[0]??null,defaults,accountLinkCoverage:accountLinkCoverage(result.chart,classifications,result.policy?.rules??[],defaults.rules)};
}
export async function writeReportingPolicy(input:unknown){
 assertLiveStatements();
 const q=command.parse(input),{supabase,user}=await requireUser();
 if(q.action==='create-expense-classification'){
  const workspace=await readReportingPolicy({organization:q.organization,fiscalStart:q.fiscalStart});
  if(!workspace.canSave)throw Error('REPORTING_ACCESS_DENIED');
  const allowed=unwrap(await supabase.rpc('effective_organization_permission',{
   p_org:q.organization,p_permission:'organization.edit',p_amount:null,p_currency:null,
  }));
  if(!allowed)throw Error('REPORTING_ACCESS_DENIED');
  const result=await supabase.from('financial_classifications').insert({
   organization_id:q.organization,code:q.code,name:q.name,classification_type:'OPEX',is_system:false,created_by:user.id,
  }).select('id,code,name').single();
  if(result.error?.code==='23505')throw Error('REPORTING_CLASSIFICATION_DUPLICATE');
  return unwrap(result);
 }

 if(q.action==='activate-defaults'){
  const scope={organization:q.organization,fiscalStart:q.fiscalStart};
  let workspace=await readReportingPolicy(scope);
  if(!workspace.canSave||!workspace.canApprove)throw Error('REPORTING_APPROVE_DENIED');
  // Provision once, per organization. Source parties are never chart accounts.
  const roles=unwrap(await supabase.rpc('prepare_financial_posting_defaults',{
   p_org:q.organization,p_fiscal_start:q.fiscalStart,
  })) as PostingAccountRoles;
  if(POSTING_BASE_CLASSIFICATIONS.some(([code])=>!workspace.classifications.some(c=>c.code===code))){
   const allowed=unwrap(await supabase.rpc('effective_organization_permission',{p_org:q.organization,p_permission:'organization.edit',p_amount:null,p_currency:null}));
   if(!allowed)throw Error('REPORTING_CLASSIFICATIONS_REQUIRED');
   unwrap(await supabase.from('financial_classifications').upsert(POSTING_BASE_CLASSIFICATIONS.map(([code,name])=>({organization_id:q.organization,code,name,classification_type:code,is_system:false,created_by:user.id})),{onConflict:'organization_id,code',ignoreDuplicates:true}));
  }
  // Existing banks must resolve the voucher-selected cash side before activation.
  // The scoped idempotent command preserves balances and existing chart links.
  unwrap(await supabase.rpc('link_financial_cash_accounts',{p_org:q.organization}));
  unwrap(await supabase.rpc('prepare_financial_account_rule_links',{p_org:q.organization}));
  workspace=await readReportingPolicy(scope);
  const prepared=readyPostingDefaults(workspace.classifications,workspace.chart,workspace.events,workspace.policy?.rules??[],roles);
  if(prepared.issue)throw Error(prepared.issue);
  // No arbitrary event signatures are accepted from the browser. Approval's
  // existing source-coverage and historical-resolution gates still apply.
  unwrap(await supabase.rpc('activate_financial_posting_defaults',{
   p_org:q.organization,p_fiscal_start:q.fiscalStart,p_policy_id:workspace.policy?.id??null,
   p_expected_version:workspace.policy?.version??0,p_rules:prepared.rules,
  }));
  return readReportingPolicy(scope);
 }

 if(q.action==='synchronize-accounts'){
  unwrap(await supabase.rpc('prepare_financial_account_rule_links',{p_org:q.organization}));
  return readReportingPolicy({organization:q.organization,fiscalStart:q.fiscalStart});
 }
 if(q.action==='initialize-defaults'){
  const scope={organization:q.organization,fiscalStart:q.fiscalStart};
  let workspace=await readReportingPolicy(scope);
  // Nonempty policies are immutable to initialization. Empty legacy policies
  // require explicit recovery intent; approved records remain untouched and
  // the audited save RPC creates a separate unapproved draft.
  if(!workspace.canSave)throw Error('REPORTING_ACCESS_DENIED');
  const preserve=()=>workspace.policy&&(!q.repairEmpty||workspace.policy.rules.length>0);
  if(preserve())return workspace;
  if(POSTING_BASE_CLASSIFICATIONS.some(([code])=>!workspace.classifications.some(c=>c.code===code))){
   const allowed=unwrap(await supabase.rpc('effective_organization_permission',{p_org:q.organization,p_permission:'organization.edit',p_amount:null,p_currency:null}));
   if(!allowed)throw Error('REPORTING_CLASSIFICATIONS_REQUIRED');
   unwrap(await supabase.from('financial_classifications').upsert(POSTING_BASE_CLASSIFICATIONS.map(([code,name])=>({organization_id:q.organization,code,name,classification_type:code,is_system:false,created_by:user.id})),{onConflict:'organization_id,code',ignoreDuplicates:true}));
   workspace=await readReportingPolicy(scope);
   if(preserve())return workspace;
  }
  if(!workspace.defaults.rules.length)throw Error('REPORTING_DEFAULT_ACCOUNTS_REQUIRED');
  const issue=validatePostingRuleAccounts(workspace.defaults.rules,workspace.chart);if(issue)throw Error(issue);
  const saved=await supabase.rpc('save_financial_reporting_policy',{
   p_org:q.organization,p_fiscal_start:q.fiscalStart,p_expected_version:workspace.policy?.status==='DRAFT'?workspace.policy.version:0,
   p_rules:workspace.defaults.rules,p_reason:'Default posting rules v1 — organization chart; review before approval',
  });
  // Two sessions initializing together must converge on the winner's policy.
  if(saved.error&&!/REPORTING_VERSION_CONFLICT/.test(saved.error.message))unwrap(saved);
  unwrap(await supabase.rpc('prepare_financial_account_rule_links',{p_org:q.organization}));
  return readReportingPolicy(scope);
 }
 if(q.action==='approve')
  return unwrap(await supabase.rpc('approve_financial_reporting_policy',{
   p_id:q.id,p_expected_version:q.expectedVersion}));
 // Check actual permitted postable accounts, not a browser-provided account list.
 // The database remains the authoritative permission, revision and source gate.
 const chart=unwrap(await supabase.rpc('financial_chart_posting_accounts',{
  p_org:q.organization})) as PostingChartAccount[];
 const issue=validatePostingRuleAccounts(q.rules,chart);
 if(issue)throw Error(issue);
 return unwrap(await supabase.rpc('save_financial_reporting_policy',{
  p_org:q.organization,p_fiscal_start:q.fiscalStart,p_expected_version:q.expectedVersion,
  p_rules:q.rules,p_reason:q.reason}));
}
