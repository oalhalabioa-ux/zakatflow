import {defaultLegalItems,evaluateStudy,type FeasibilityStudy} from './engine';

export type HandoffCheck={key:string;ar:string;en:string;passed:boolean};

/** Advisory preflight only; local review is NOT a statutory approval or accounting authorization. */
export function handoffReadiness(study:FeasibilityStudy){
 const model=evaluateStudy(study);
 const critical=defaultLegalItems.slice(0,3);
 const legalVerified=critical.every(title=>study.legal.some(item=>item.title===title&&item.status==='VERIFIED'));
 const checks:HandoffCheck[]=[
  {key:'decision',ar:'تحديد قرار المشروع: معتمد مبدئيًا أو قيد التأسيس',en:'Project is approved in principle or in establishment',passed:study.status==='APPROVED'||study.status==='ESTABLISHMENT'},
  {key:'identity',ar:'بيانات المشروع والدولة والعملة مكتملة',en:'Project, country and study currency are set',passed:Boolean(study.title.trim()&&study.country.trim()&&/^[A-Z]{3}$/.test(study.currency))},
  {key:'model',ar:'تكلفة الاستثمار وافتراضات التشغيل قابلة للتقييم',en:'Investment and operating assumptions are assessable',passed:model.ready},
  // A negative gap is unexplained surplus cash, not authorization to overfund the project.
  // Require an explicitly balanced cash plan before taking an internal review snapshot.
  {key:'finance',ar:'التمويل النقدي متوازن دون عجز أو فائض غير مخصص',en:'Cash funding balances without uncovered gap or unallocated surplus',passed:Number.isFinite(model.cashFundingGap)&&Math.abs(model.cashFundingGap)<=0.01},
  {key:'legal',ar:'تحقق أولي من ملكية الموقع والتقييم والتراخيص',en:'Preliminary land, valuation and licensing checks verified',passed:legalVerified},
  {key:'blockers',ar:'لا يوجد مانع قانوني مسجل',en:'No recorded legal blocker',passed:!study.legal.some(x=>x.status==='BLOCKED')}
 ];
 return {checks,ready:checks.every(x=>x.passed)};
}
export function handoffSetupPath(locale:string,organizationId:string,authorizedIds:readonly string[]):string|null{
 if(!['ar','en'].includes(locale)||!authorizedIds.includes(organizationId))return null;
 if(!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(organizationId))return null;
 return '/'+locale+'/settings/financial/setup?organization='+encodeURIComponent(organizationId);
}
