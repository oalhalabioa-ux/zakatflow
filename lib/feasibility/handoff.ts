import {evaluateAdvanced} from './advanced-model';
import {advancedIssueNames} from './advanced-readiness-labels';
import {evaluateRawLand} from './raw-land';
import {evaluateWater,effectiveWaterInputs,waterFinancialReadiness,waterPeakFundingGap} from './water-model';
import {defaultLegalItems,evaluateStudy,type FeasibilityStudy} from './engine';

export type HandoffCheck={key:string;ar:string;en:string;passed:boolean};

/** Advisory preflight only; local review is NOT a statutory approval or accounting authorization. */
export function handoffReadiness(study:FeasibilityStudy){
 const model=evaluateStudy(study);
 const water=study.water&&evaluateWater(study.water);
 const land=study.rawLand&&evaluateRawLand(study.rawLand);
 // Studies without advanced inputs retain their existing financial readiness rules.
 const advanced=!land&&!water&&study.advanced?evaluateAdvanced(study):null;
 const critical=defaultLegalItems.slice(0,3);
 const waterChecks=study.legal.filter(item=>item.critical);
 const legalVerified=water||land
  ?waterChecks.length>0&&waterChecks.every(item=>item.status==='VERIFIED'&&item.notes.trim())
  :critical.every(title=>study.legal.some(item=>item.title===title&&item.status==='VERIFIED'));
 const balanced=land?land.issue===null&&land.ready&&(land.annual.at(-1)?.closingDebt??0)<=.01&&
  land.peakEquityDeficit<=(study.rawLand?.quantityDevelopment?.committedEquity??0)+.01:
  study.water&&water
  ?water.ready&&study.water.deal.extraFunding===0&&study.water.deal.investorLoan<=water.cashRequired&&
   waterPeakFundingGap(water.annual)<=.01&&(!water.totalLoan||
   (study.water.deal.loanYears>0&&study.water.deal.loanStart>0))
  :advanced?advanced.ready&&advanced.equityReady
  :Number.isFinite(model.cashFundingGap)&&Math.abs(model.cashFundingGap)<=0.01;
 const checks:HandoffCheck[]=[
  {key:'decision',ar:'تحديد قرار المشروع: معتمد مبدئيًا أو قيد التأسيس',en:'Project is approved in principle or in establishment',passed:study.status==='APPROVED'||study.status==='ESTABLISHMENT'},
  {key:'identity',ar:'بيانات المشروع والدولة والعملة مكتملة',en:'Project, country and study currency are set',passed:Boolean(study.title.trim()&&study.country.trim()&&/^[A-Z]{3}$/.test(study.currency))},
  {key:'model',ar:'تكلفة الاستثمار وافتراضات التشغيل قابلة للتقييم',en:'Investment and operating assumptions are assessable',passed:land?land.issue===null&&land.ready:water?.ready??advanced?.ready??model.ready},
  // A negative gap is unexplained surplus cash, not authorization to overfund the project.
  // Require an explicitly balanced cash plan before taking an internal review snapshot.
  {key:'finance',ar:'التمويل النقدي متوازن دون عجز أو فائض غير مخصص',en:'Cash funding balances without uncovered gap or unallocated surplus',passed:balanced},
  {key:'legal',ar:'تحقق أولي من ملكية الموقع والتقييم والتراخيص',en:'Preliminary land, valuation and licensing checks verified',passed:legalVerified},
  {key:'blockers',ar:'لا يوجد مانع قانوني مسجل',en:'No recorded legal blocker',passed:!study.legal.some(x=>x.status==='BLOCKED')}
 ];
 if(study.water?.quantityCosting)checks.push({key:'quantity',ar:'الكميات وأسعار الوحدات موثقة ومكتملة',en:'Quantities and unit prices are complete and documented',passed:effectiveWaterInputs(study.water).readiness.ready});
 if(study.water)checks.push({key:'financial-policy',ar:'منهج الإهلاك ورأس المال العامل موثق وقابل للتحقق',en:'Depreciation and working capital methods are documented and assessable',passed:waterFinancialReadiness(study.water).ready});
 if(study.water&&(study.water.financingPolicy||water?.totalLoan))checks.push({key:'financing-policy',ar:'شروط القرض وعوائد الملكية موثقة والدين عند النهاية معالج',en:'Debt terms and equity returns documented and terminal debt addressed',passed:water?.financingReadiness?.ready??false});
 if(land&&land.issue===null&&study.rawLand?.quantityDevelopment)checks.push({key:'quantity',ar:'كميات التطوير وأسعارها موثقة ومكتملة',en:'Development quantities and prices are complete and documented',passed:land.quantityReadiness?.ready??false});
 const highRisk=study.risks.some(x=>x.impact*x.likelihood>=15);
 const isRiskUnresolved=study.risks.some(x=>x.impact*x.likelihood>=15&&(x.status!=='MITIGATED'||!x.response.trim()));
 const isExecutionBlocked=study.tasks.some(x=>x.priority==='HIGH'&&x.status==='BLOCKED');
 if(water||land||highRisk)checks.push({key:'risk',ar:'معالجة المخاطر المرتفعة وعدم ترك مخاطر مرتفعة دون استجابة',en:'High risks are mitigated with documented responses',passed:!isRiskUnresolved});
 if(water||land||isExecutionBlocked)checks.push({key:'execution',ar:'عدم وجود مهمة تنفيذ عالية الأولوية معلّقة',en:'No blocked high-priority implementation task',passed:!isExecutionBlocked});
 const detailed=study.water?.quantityCosting??study.rawLand?.quantityDevelopment;
 if(detailed)checks.push({key:'assumptions',ar:'توثيق افتراضات التشغيل والبيع والتمويل ومصادرها',en:'Operating, sales and financing assumptions and sources documented',passed:Boolean(detailed.assumptionSource?.trim())});
 for(const key of [...(advanced?.blockers??[]),...(advanced?.equityBlockers??[])]){
  const [ar,en]=advancedIssueNames[key]??[key,key];
  checks.push({key:'advanced-'+key,ar,en,passed:false});
 }
 return {checks,ready:checks.every(x=>x.passed)};
}
export function handoffSetupPath(locale:string,organizationId:string,authorizedIds:readonly string[]):string|null{
 if(!['ar','en'].includes(locale)||!authorizedIds.includes(organizationId))return null;
 if(!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(organizationId))return null;
 return '/'+locale+'/settings/financial/setup?organization='+encodeURIComponent(organizationId);
}
