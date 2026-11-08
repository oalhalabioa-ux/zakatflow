import type {FinancialSetupMode,FinancialSetupStep} from './financial-setup-steps';
import type {FinancialSetupReadiness,SetupStatus} from './financial-setup-readiness';

/** Display and navigation only. Never used for accounting posting/approval.
 * Deferral is a local note, not a persisted policy decision or source proof.
 */
export const FINANCIAL_SETUP_STEP_HELP:Readonly<Partial<Record<FinancialSetupStep,{ar:string;en:string}>>>={
 organization:{ar:'تحديد بيانات المؤسسة ووضعها',en:'Verify organization identity and setup mode'},
 regulatory:{ar:'ملف البائع والعنوان الوطني وحالة التسجيل الضريبي ووحدة الفوترة',en:'Seller address, tax registration and invoice unit'},
 structure:{ar:'مراجعة الفروع والوحدات التنظيمية (اختياري)',en:'Review subsidiaries and structure (optional)'},
 chart:{ar:'اختيار الحسابات والتصنيفات الفعلية',en:'Configure the actual chart and classifications'},
 fiscal:{ar:'بداية ونهاية السنة وحساب الأرباح المحتجزة',en:'Fiscal year and retained earnings account'},
 posting:{ar:'ربط العمليات بأطراف القيد المدين والدائن',en:'Map voucher events to balanced posting accounts'},
 banking:{ar:'الحسابات البنكية والصندوق وإدارة السيولة',en:'Bank and cash accounts and liquidity'},
 opening:{ar:'مراجعة مصادر الأرصدة السابقة ومنع الازدواج',en:'Verify opening sources and prevent duplicates'},
 users:{ar:'المستخدمون والصلاحيات والدعوات',en:'Members, permissions and invitations'},
 review:{ar:'تدقيق حالة الإعداد قبل الإنهاء',en:'Verify setup status before completion'},
 finished:{ar:'اكتمال رحلة التهيئة',en:'Setup journey completed'},
};

/** Some steps may be visited out of order, but an incomplete prerequisite
 * must never be labelled complete or silently waived.
 */
export function canDeferSetupStep(
 step:FinancialSetupStep,
 mode:FinancialSetupMode|null,
 statuses:Partial<Record<FinancialSetupStep,SetupStatus>>|null,
):boolean{
 if(!mode||!statuses||statuses.organization!=='READY'||statuses[step]==='READY')return false;
 switch(step){
  case 'structure':return true; // Optional organizational inspection
  case 'regulatory':return true; // Independent of chart/fiscal posting; never statutory certification
  case 'chart':return statuses.fiscal==='READY'; // Fiscal retained-account dependency already met
  case 'fiscal':return statuses.posting==='READY'; // The next financial dependency already met
  case 'posting':return true; // Bank account review does not require posting-policy approval
  case 'banking':return true; // May inspect opening, but not approve dependent bank sources
  case 'opening':return true; // User invitation work is independent of opening approval
  case 'users':return true; // Review is inspectable; finalization still requires source checks
  default:return false;
 }
}
export function setupJourneyStepState(
 step:FinancialSetupStep,
 readiness:FinancialSetupReadiness|null,
 deferred:readonly FinancialSetupStep[],
 reviewed:readonly FinancialSetupStep[],
 mode:FinancialSetupMode|null,
):'COMPLETE'|'INCOMPLETE'|'DEFERRED'|'OPTIONAL'|'BLOCKED'|'VERIFYING'|'REVIEWED'{
 if(step==='structure')return reviewed.includes('structure')?'REVIEWED':deferred.includes('structure')?'DEFERRED':'OPTIONAL';
 if(step==='regulatory')return reviewed.includes('regulatory')?'REVIEWED':deferred.includes('regulatory')?'DEFERRED':'INCOMPLETE';
 const status=readiness?.statuses[step];
 if(!status)return 'VERIFYING';
 if(step==='opening'&&mode==='NEW'&&status==='READY')return 'OPTIONAL';
 if(status==='READY')return 'COMPLETE';
 if(deferred.includes(step))return 'DEFERRED';
 if(status==='BLOCKED')return 'BLOCKED';
 return 'INCOMPLETE';
}
export function financialSetupJourneyCounts(readiness:FinancialSetupReadiness|null,deferred:readonly FinancialSetupStep[]){
 const accounted:FinancialSetupStep[]=['organization','chart','fiscal','posting','banking','opening','users'];
 const complete=readiness?accounted.filter(step=>readiness.statuses[step]==='READY').length:0;
 const remaining=accounted.length-complete;
 const deferredCount=deferred.filter(step=>accounted.includes(step)&&readiness?.statuses[step]!=='READY').length;
 return {total:accounted.length,complete,remaining,deferred:deferredCount,percent:Math.round(100*complete/accounted.length)};
}

/** Resume at the first missing independently checked financial requirement.
 * This is navigation only; it cannot certify legal, tax or posting readiness.
 */
export function firstMissingFinancialSetupStep(
 readiness:FinancialSetupReadiness|null,mode:FinancialSetupMode|null,
):FinancialSetupStep{
 if(!readiness||!mode||readiness.statuses.organization!=='READY')return 'organization';
 for(const step of ['chart','fiscal','posting','banking','opening','users'] as const){
  if(readiness.statuses[step]!=='READY')return step;
 }
 return 'review';
}
