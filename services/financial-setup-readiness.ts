import {z} from 'zod';
import {requireUser} from './auth';
import {fiscalManagementContext} from './financial-fiscal-management';
import {financialChartWorkspace} from './financial-chart';
import {readOpening} from './financial-opening-workspace';
import {liveStatementSource} from './financial-statement-live';
import {financialSetupReadiness,type SetupEvidence} from '../lib/financial-setup-readiness';
import {evaluatePostingPolicy,type PostingPolicyRecord} from '../lib/financial-setup-posting-evidence';
import {readReportingPolicy} from './financial-reporting-policy';
import type {RecognitionEvent} from '../lib/financial-event-ledger';
import {hasVerifiedZeroOpening} from '../lib/financial-setup-source-proof';

const query=z.object({organization:z.string().uuid(),mode:z.enum(['NEW','EXISTING']).nullable()}).strict();

/** Read-only financial setup check. Uses ONLY the signed-in caller's RLS client
 * and existing validated RPCs; browser checkmarks are never accepted as proof.
 */
export async function readFinancialSetupReadiness(input:unknown){
 const q=query.parse(input),{supabase,user}=await requireUser();
 const member=await supabase.from('organization_members').select('organization_id')
  .eq('organization_id',q.organization).eq('user_id',user.id).eq('status','ACTIVE').maybeSingle();
 const ability=await supabase.rpc('financial_core_can',{p_org:q.organization,p_scope:'financial_core.view'});
 if(member.error||!member.data||ability.error||ability.data!==true)throw Error('SETUP_ACCESS_DENIED');
 const org=await supabase.from('organizations').select('id,name,base_currency,entity_type')
  .eq('id',q.organization).maybeSingle();
 if(org.error||!org.data||!org.data.name||!org.data.base_currency||!org.data.entity_type)
  throw Error('SETUP_ACCESS_DENIED');

 const evidence:SetupEvidence={
  organizationId:q.organization,mode:q.mode,fiscalStart:null,
  organizationValid:true,chartPostableRetained:false,fiscalCalendarValid:false,
  approvedPostingPolicy:false,bankAccountPresent:false,approvedOpening:false,
  zeroOpeningVerified:false,ownerRoleVisible:false,
  sourceChecked:false,sourceVerified:false,
 };
 const [chart,fiscal,banks,owners]=await Promise.allSettled([
  financialChartWorkspace(q.organization),fiscalManagementContext(q.organization),
  supabase.from('liquidity_accounts').select('id').eq('organization_id',q.organization).eq('active',true).limit(1),
  supabase.from('organization_members').select('role').eq('organization_id',q.organization).eq('status','ACTIVE'),
 ]);
 if(chart.status==='fulfilled'){
  const accounts=(chart.value as {accounts?:Array<{code:string;reportingCode:string;kind:string;isActive:boolean;isPostable:boolean;isSystem:boolean}>}).accounts??[];
  // The canonical 3300 equity control remains valid for grandfathered
  // organizations. A customized leaf is validated separately by the fiscal
  // calendar's authorized retained-account candidates.
  evidence.chartPostableRetained=accounts.some(a=>a.code==='3300'&&a.kind==='EQUITY'&&a.isActive);
 }
 if(banks.status==='fulfilled'&&!banks.value.error)evidence.bankAccountPresent=(banks.value.data?.length??0)>0;
 if(owners.status==='fulfilled'&&!owners.value.error)
  evidence.ownerRoleVisible=(owners.value.data??[]).some(m=>m.role==='OWNER');
 if(fiscal.status==='fulfilled'){
  const f=fiscal.value;
  const selected=f.calendar?.retained_earnings_account??'';
  evidence.fiscalCalendarValid=Boolean(f.calendar&&f.period&&
   (selected==='3300'||f.retainedCandidates?.some(c=>c.code===selected)));
  evidence.fiscalStart=f.period?.start??null;
 }
 if(evidence.fiscalStart){
  const [policies,policyWorkspace,opening]=await Promise.allSettled([
   supabase.from('financial_reporting_policies').select('status,version,rules')
    .eq('organization_id',q.organization).eq('fiscal_start',evidence.fiscalStart)
    .eq('status','APPROVED').order('version',{ascending:false}).limit(1),
   readReportingPolicy({organization:q.organization,fiscalStart:evidence.fiscalStart}),
   readOpening({organization:q.organization,fiscalStart:evidence.fiscalStart}),
  ]);
  if(policies.status==='fulfilled'&&!policies.value.error&&
    policyWorkspace.status==='fulfilled'){
   const workspace=policyWorkspace.value as {
    policy:PostingPolicyRecord|null;events:RecognitionEvent[];
   };
   // A draft in progress may be the workspace's primary record; do not
   // replace a still-active approved policy with a browser/local draft.
   const approved=policies.value.data?.[0] as PostingPolicyRecord|undefined;
   const verified=evaluatePostingPolicy(approved??workspace.policy??null,
    Array.isArray(workspace.events)?workspace.events:null);
   evidence.postingEvidence=verified;
   evidence.approvedPostingPolicy=verified.configured;
  }
  if(opening.status==='fulfilled'){
   const state=opening.value;
   evidence.approvedOpening=state.workspace?.status==='APPROVED'&&
    state.workspace.source_revision===state.source.revision&&
    !state.source.rows.some(row=>Boolean(row.sourceIssue));
   evidence.zeroOpeningVerified=hasVerifiedZeroOpening(state);
  }
 }
 // A new company cannot declare itself "no opening" merely through a browser
 // toggle: its recorded sources must independently show a clean zero opening.
 const prelim=financialSetupReadiness(evidence);
 const readyForSource=Object.entries(prelim.statuses).filter(([name])=>name!=='review'&&name!=='finished')
  .every(([,status])=>status==='READY');
 if(readyForSource&&fiscal.status==='fulfilled'&&fiscal.value.period){
  evidence.sourceChecked=true;
  try{
   await liveStatementSource({organization:q.organization,from:fiscal.value.period.start,
    to:fiscal.value.period.end});
   evidence.sourceVerified=true;
  }catch{evidence.sourceVerified=false}
 }
 // Re-check permission after the potentially long source reads. This does NOT
 // turn independent snapshots into an atomic revision certificate.
 const recheck=await supabase.rpc('financial_core_can',{p_org:q.organization,p_scope:'financial_core.view'});
 const stillMember=await supabase.from('organization_members').select('organization_id')
  .eq('organization_id',q.organization).eq('user_id',user.id).eq('status','ACTIVE').maybeSingle();
 if(recheck.error||recheck.data!==true||stillMember.error||!stillMember.data)
  throw Error('SETUP_ACCESS_DENIED');
 return financialSetupReadiness(evidence);
}
