/**
 * Pre-investment decision support only. Do not import Financial Core v1 or write journals.
 * All values are in one study currency; mixed-currency figures must be converted
 * explicitly by an analyst before inclusion.
 */
export type Sector='INDUSTRIAL'|'COMMERCIAL'|'REAL_ESTATE'|'SERVICES'|'AGRICULTURE'|'CUSTOM';
export type StudyStatus='IDEA'|'FEASIBILITY'|'APPROVED'|'ESTABLISHMENT'|'OPERATING'|'CANCELLED';
export type TaskStatus='TODO'|'IN_PROGRESS'|'DONE';
export type ChecklistStatus='NOT_STARTED'|'UNDER_REVIEW'|'VERIFIED'|'BLOCKED';
export type StudyTab='overview'|'profile'|'investment'|'partners'|'operations'|'scenarios'|'cashflow'|'legal'|'tasks'|'risks'|'suppliers'|'decisions'|'handoff'|'sharing';
export type HandoffMode='LATER'|'NEW'|'EXISTING';
export interface ProjectHandoff {mode:HandoffMode; organizationId?:string; reviewedSourceUpdatedAt?:string; reviewedAt?:string;}
export interface CapexItem {id:string;label:string;amount:number;category:'BUILDINGS'|'EQUIPMENT'|'UTILITIES'|'LICENCES'|'OTHER';}
export interface StudyTask {id:string;title:string;owner:string;due:string;status:TaskStatus;priority:'HIGH'|'NORMAL'|'LOW';}
export interface LegalItem {id:string;title:string;status:ChecklistStatus;notes:string;}
export interface StudyRisk {id:string;title:string;likelihood:number;impact:number;response:string;}
export interface StudySupplier {id:string;vendor:string;item:string;offer:number;notes:string;}
export interface StudyDecision {id:string;title:string;date:string;notes:string;}
export interface FeasibilityStudy {
 id:string; title:string; sector:Sector; country:string; region:string; currency:string; status:StudyStatus;
 landValue:number; landTransferred:boolean; investorEquity:number; partnerCashEquity:number;
 investorLoan:number; otherDebt:number; workingCapital:number; annualMaintenance:number;
 unitPrice:number; variableCost:number; monthlyUnits:number; monthlyFixedCost:number; volumeGrowthPct:number;
 priceGrowthPct:number; fixedCostGrowthPct:number; discountRatePct:number; indicativeTaxRatePct:number; years:number;
 capex:CapexItem[];tasks:StudyTask[];legal:LegalItem[];risks:StudyRisk[];suppliers:StudySupplier[];decisions:StudyDecision[];handoff?:ProjectHandoff;
 createdAt:string; updatedAt:string;
}
export type Scenario='CONSERVATIVE'|'BASE'|'OPTIMISTIC';
const nonneg=(n:number)=>Number.isFinite(n)?Math.max(0,n):0;
const sum=(items:readonly number[])=>items.reduce((a,b)=>a+nonneg(b),0);
export const scenarioLabels:Record<Scenario,{ar:string;en:string}>={
 CONSERVATIVE:{ar:'متحفظ',en:'Conservative'},BASE:{ar:'أساسي',en:'Base'},OPTIMISTIC:{ar:'متفائل',en:'Optimistic'}
};
const adjustments:Record<Scenario,{volume:number;price:number;variable:number}>={
 CONSERVATIVE:{volume:.7,price:.95,variable:1.1},
 BASE:{volume:1,price:1,variable:1},
 OPTIMISTIC:{volume:1.2,price:1.03,variable:.97}
};
export const defaultLegalItems=[
 'التحقق من ملكية الأرض أو حق استخدام الموقع',
 'تقييم المساهمات العينية بواسطة جهة مستقلة',
 'التحقق من تراخيص النشاط وقابليتها للاستخدام باسم الشركة',
 'فحص الاشتراطات البيئية والبلدية والسلامة بحسب النشاط',
 'مراجعة تكوين الشركة والعقد الأساسي واتفاق الشركاء',
 'التأكد من ملكية المباني والمعدات وحقوق التخارج',
 'اعتماد آلية التمويل الإضافي وتعديل الحصص',
 'مراجعة الضرائب والرسوم والحوافز وفق النظام النافذ'
] as const;
export const waterFactoryLegalItems=[
 'موافقة الموارد المائية على مصدر المياه والكميات المصرح بها',
 'فحص مياه معتمد كيميائيًا وجرثوميًا واختبار معدل الضخ',
 'التحقق من ترخيص التعبئة والغذاء والمواصفات الفنية'
] as const;
export function createStudy(id:string,title:string,sector:Sector='INDUSTRIAL'):FeasibilityStudy{
 const now=new Date().toISOString();
 return {id,title,sector,country:'سوريا',region:'',currency:'USD',status:'IDEA',landValue:0,landTransferred:false,
 investorEquity:0,partnerCashEquity:0,investorLoan:0,otherDebt:0,workingCapital:0,annualMaintenance:0,
 unitPrice:0,variableCost:0,monthlyUnits:0,monthlyFixedCost:0,volumeGrowthPct:0,priceGrowthPct:0,
 fixedCostGrowthPct:0,discountRatePct:12,indicativeTaxRatePct:0,years:5,
 capex:[{id:'buildings',label:'الإنشاءات والمباني',amount:0,category:'BUILDINGS'},{id:'equipment',label:'خطوط الإنتاج والمعدات',amount:0,category:'EQUIPMENT'},{id:'utilities',label:'التجهيزات والبنية التحتية',amount:0,category:'UTILITIES'}],
 legal:defaultLegalItems.map((title,i)=>({id:'legal-'+i,title,status:'NOT_STARTED',notes:''})),
 tasks:[{id:'task-land',title:'فحص ملكية الأرض وتقييمها',owner:'',due:'',status:'TODO',priority:'HIGH'},
 {id:'task-water',title:'التأكد من مصدر المياه والتراخيص',owner:'',due:'',status:'TODO',priority:'HIGH'},
 {id:'task-cost',title:'استلام عروض أسعار خطوط الإنتاج',owner:'',due:'',status:'TODO',priority:'HIGH'}],
 risks:[],suppliers:[],decisions:[],createdAt:now,updatedAt:now};
}
export interface AnnualProjection {year:number;volume:number;revenue:number;variable:number;fixed:number;ebitda:number;taxEstimate:number;maintenance:number;freeCashFlow:number;}
function npvAt(rate:number,flows:number[]):number {
 return flows.reduce((acc,v,t)=>acc+v/Math.pow(1+rate,t),0);
}
export function internalRateOfReturn(flows:number[]):number|null{
 if(flows.length<2||!flows.some(v=>v<0)||!flows.some(v=>v>0))return null;
 let low=-.95,high=10,fl=npvAt(low,flows),fh=npvAt(high,flows);
 if(!Number.isFinite(fl)||!Number.isFinite(fh)||fl*fh>0)return null;
 for(let i=0;i<180;i++){const mid=(low+high)/2,fm=npvAt(mid,flows);if(!Number.isFinite(fm))return null;if(Math.abs(fm)<1e-7)return mid*100;if(fm*fl>0){low=mid;fl=fm;}else{high=mid;fh=fm;}}
 return (low+high)*50;
}
export function evaluateStudy(s:FeasibilityStudy,scenario:Scenario='BASE'){
 const c=adjustments[scenario],capex=sum(s.capex.map(x=>x.amount));
 const landAsset=s.landTransferred?nonneg(s.landValue):0;
 const cashEquity=nonneg(s.investorEquity)+nonneg(s.partnerCashEquity);
 const equity=cashEquity+landAsset;
 const investorShare=equity>0?nonneg(s.investorEquity)/equity*100:null;
 const partnerShare=equity>0?(nonneg(s.partnerCashEquity)+landAsset)/equity*100:null;
 const totalInvestment=capex+landAsset+nonneg(s.workingCapital);
 const cashFundingGap=capex+nonneg(s.workingCapital)-cashEquity-nonneg(s.investorLoan)-nonneg(s.otherDebt);
 const annual:AnnualProjection[]=[];
 const projectedYears=Math.min(20,Math.max(1,Math.trunc(s.years)||5));
 const initial=-(totalInvestment);
 const flows=[initial];
 const discount=nonneg(s.discountRatePct)/100;
 const basePrice=nonneg(s.unitPrice)*c.price;
 const baseCost=nonneg(s.variableCost)*c.variable;
 const taxRate=Math.min(1,nonneg(s.indicativeTaxRatePct)/100);
 for(let year=1;year<=projectedYears;year++){
  const volume=nonneg(s.monthlyUnits)*12*c.volume*Math.pow(1+nonneg(s.volumeGrowthPct)/100,year-1);
  const price=basePrice*Math.pow(1+nonneg(s.priceGrowthPct)/100,year-1);
  const variableCost=baseCost*volume;
  const revenue=volume*price;
  const fixed=nonneg(s.monthlyFixedCost)*12*Math.pow(1+nonneg(s.fixedCostGrowthPct)/100,year-1);
  const ebitda=revenue-variableCost-fixed;
  // Indicative only: not a statutory tax base. Depreciation, loss carryforwards, etc. are omitted.
  const taxEstimate=Math.max(0,ebitda)*taxRate;
  const maintenance=nonneg(s.annualMaintenance);
  const freeCashFlow=ebitda-taxEstimate-maintenance+(year===projectedYears?nonneg(s.workingCapital):0);
  annual.push({year,volume,revenue,variable:variableCost,fixed,ebitda,taxEstimate,maintenance,freeCashFlow});
  flows.push(freeCashFlow);
 }
 const ready=capex>0&&nonneg(s.unitPrice)>0&&nonneg(s.monthlyUnits)>0;
 const npv=ready?npvAt(discount,flows):null;
 const irr=ready?internalRateOfReturn(flows):null;
 let paybackYears:null|number=null;
 if(ready){let cumulative=flows[0];for(let i=1;i<flows.length;i++){const prev=cumulative;cumulative+=flows[i];if(prev<0&&cumulative>=0&&flows[i]>0){paybackYears=i-1+(-prev/flows[i]);break;}}}
 const margin=basePrice-baseCost;
 const breakevenMonthlyUnits=margin>0?nonneg(s.monthlyFixedCost)/margin:null;
 return {capex,landAsset,equity,cashEquity,investorShare,partnerShare,totalInvestment,cashFundingGap,
 annual,flows,npv,irr,paybackYears,breakevenMonthlyUnits,ready,margin,
 notes:['التدفقات تمثل المشروع قبل خدمة الديون، وليست تدفقات الشريك الشخصية.',
 'الأرض المحولة ملكيتها حصة عينية غير نقدية؛ لا تُستخدم لسداد مصروفات التأسيس.',
 'ضريبة الدخل هنا نسبة افتراضية على EBITDA لأغراض الاستكشاف وليست حساباً قانونياً.',
 'التوقعات سنوية ومبسطة ولا تشمل جداول الإهلاك والتمويل والضرائب الفعلية والتضخم المتغير.']};
}
