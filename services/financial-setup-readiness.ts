import {z} from 'zod';
import {requireUser} from './auth';
import {fiscalManagementContext} from './financial-fiscal-management';
import {financialChartWorkspace} from './financial-chart';
import {readOpening} from './financial-opening-workspace';
import {liveStatementSource} from './financial-statement-live';
import {financialSetupReadiness,type SetupEvidence} from '../lib/financial-setup-readiness';

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
  supabase.from('liquidity_accounts').select('id').eq('organization_id',q.organization).limit(1),
  supabase.from('organization_members').select('role').eq('organization_id',q.organization).eq('status','ACTIVE'),
 ]);
 if(chart.status==='fulfilled'){
  const accounts=(chart.value as {accounts?:Array<{code:string;reportingCode:string;isActive:boolean;isPostable:boolean;isSystem:boolean}>}).accounts??[];
  evidence.chartPostableRetained=accounts.some(a=>a.reportingCode==='3300'&&a.isActive&&a.isPostable&&!a.isSystem&&/^3300\d{2}(?:\d{2}){0,2}$/.test(a.code));
 }
 if(banks.status==='fulfilled'&&!banks.value.error)evidence.bankAccountPresent=(banks.value.data?.length??0)>0;
 if(owners.status==='fulfilled'&&!owners.value.error)
  evidence.ownerRoleVisible=(owners.value.data??[]).some(m=>m.role==='OWNER');
 if(fiscal.status==='fulfilled'){
  const f=fiscal.value;
  const selected=f.calendar?.retained_earnings_account??'';
  evidence.fiscalCalendarValid=Boolean(f.calendar&&f.period&&
   f.retainedCandidates?.some(c=>c.code===selected));
  evidence.fiscalStart=f.period?.start??null;
 }
 if(evidence.fiscalStart){
  const [policies,opening]=await Promise.allSettled([
   supabase.from('financial_reporting_policies').select('status,fiscal_start,fiscal_end')
    .eq('organization_id',q.organization).eq('fiscal_start',evidence.fiscalStart).eq('status','APPROVED').limit(1),
   readOpening({organization:q.organization,fiscalStart:evidence.fiscalStart}),
  ]);
  if(policies.status==='fulfilled'&&!policies.value.error)
   evidence.approvedPostingPolicy=(policies.value.data?.length??0)>0;
  if(opening.status==='fulfilled'){
   const state=opening.value;
   evidence.approvedOpening=state.workspace?.status==='APPROVED'&&
    !state.source.rows.some(row=>Boolean(row.sourceIssue));
   evidence.zeroOpeningVerified=!state.workspace&&state.source.rows.every(row=>
     !row.sourceIssue&&row.vouchers.every(v=>
      Number(v.debit??0)===0&&Number(v.credit??0)===0));
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
