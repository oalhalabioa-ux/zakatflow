import type {FeasibilityStudy} from './engine';
import type {HandoffCheck} from './handoff';
import {licenceReviewReason} from './licence-review';
import {effectiveWaterInputs, type evaluateWater} from './water-model';

const materialBlockers = new Set(['identity','model','finance','blockers','risk','execution']);

export function investmentAssessment(study:FeasibilityStudy,checks:readonly HandoffCheck[],water?:ReturnType<typeof evaluateWater>){
 const calculated=checks.some(check=>check.key==='model'&&check.passed);
 const open=checks.filter(check=>!check.passed&&check.key!=='decision');
 const openCriticalLicence=study.legal.some(item=>item.critical&&licenceReviewReason(item)!==null);
 const material=(check:HandoffCheck)=>materialBlockers.has(check.key)||(check.key==='legal'&&openCriticalLicence);
 const blockers=open.filter(material);
 const evidence=open.filter(check=>!material(check));
 const source=study.water?.quantityCosting?.assumptionSource??study.rawLand?.quantityDevelopment?.assumptionSource;
 const hasQuote=study.suppliers.some(quote=>quote.status==='SELECTED'&&quote.vendor.trim()&&quote.item.trim()&&quote.offer>0&&quote.notes.trim());
 if(calculated&&!source?.trim()&&!hasQuote&&!evidence.some(check=>check.key==='assumptions'))evidence.push({
  key:'cost-source',passed:false,ar:'وثّق مصدر تقديرات التكاليف أو مرجع عرض المورد المختار',
  en:'Document the cost assumptions or the reference for the selected supplier quote'
 });
 if(calculated&&study.water&&water){
  const plannedDemand=water.waterDemand*Math.max(0,...water.annual.map(year=>year.utilization))/100;
  const licensed=effectiveWaterInputs(study.water).ops.licensedWaterM3Day;
  const sourcePlan=study.water.operationsPlan;
  const pumped=(sourcePlan?.pumpingM3Hour??0)*(sourcePlan?.sourceHoursDay??0);
  const knownLimits=[licensed,pumped].filter(limit=>limit>0);
  if(knownLimits.some(limit=>plannedDemand>limit+1e-6))blockers.push({
   key:'water-capacity',passed:false,ar:'احتياج المياه في أعلى سنة تشغيل يتجاوز الضخ المتاح أو الكمية المرخصة',
   en:'Peak-year water demand exceeds pumping capacity or the licensed volume'
  });
  else if(knownLimits.length<2)evidence.push({
   key:'water-capacity',passed:false,ar:'أثبت قدرة الضخ والكمية المرخصة لمصدر المياه',
   en:'Verify pumping capacity and the licensed volume of the water source'
  });
 }
 return {calculated,blockers,evidence,status:!calculated||blockers.length?'BLOCKED':evidence.length?'NEEDS_EVIDENCE':'CALCULATED'} as const;
}
