import {z} from 'zod';
import {internalRateOfReturn, type FeasibilityStudy} from './engine';
import {quantityBudgetSchema,evaluateQuantityBudget} from './quantity-costs';
import {waterFinancingPolicySchema,waterDebtSchedule,waterFinancingReadiness,waterEquityReturns} from './water-financing';

const amount=z.number().finite().min(0).max(1e12);
const pct=z.number().finite().min(0).max(100);
const multiplier=z.number().finite().min(0).max(1000);
export const waterCapexItemKeys=['buildings','line','treatment','power','lab','vehicles','licenses','others'] as const;
export type WaterCapexItemKey=typeof waterCapexItemKeys[number];
export const waterScenarioSchema=z.object({
 name:z.string().trim().min(1).max(120),volume:multiplier,price:multiplier,cost:multiplier
}).strict();
const waterUnitCosts=z.object({
 bottle:amount,cap:amount,label:amount,carton:amount,kwh:amount,rawWaterM3:amount,distributionKm:amount
}).strict();
export const emptyWaterUnitCosts={bottle:0,cap:0,label:0,carton:0,kwh:0,rawWaterM3:0,distributionKm:0};
export const waterModelSchema=z.object({
 financingPolicy:waterFinancingPolicySchema.optional(),
 financialPolicy:z.object({
  workingCapitalMode:z.enum(['PERCENT','CYCLE']),inventoryDays:z.number().int().min(0).max(3650),
  payableDays:z.number().int().min(0).max(3650),daysPerYear:z.union([z.literal(360),z.literal(365)]),
  depreciationMode:z.enum(['LEGACY','CAPPED','CLASSES']),
  assetLives:z.partialRecord(z.enum(waterCapexItemKeys),z.number().int().min(1).max(60)),
  workingCapitalRecoveryPct:pct,terminalAssetProceeds:amount,evidence:z.string().max(3000),
 }).strict().optional(),
 quantityCosting:z.object({
  builtArea:amount,capital:quantityBudgetSchema,fixed:quantityBudgetSchema,assumptionSource:z.string().max(3000).optional(),
  materialsEnabled:z.boolean(),materialSource:z.string().max(1000),productionEnabled:z.boolean().optional(),
  landByArea:z.boolean(),landUnitPrice:amount,landSource:z.string().max(1000),
 }).strict().optional(),
 capexQuoteSources:z.partialRecord(z.enum(waterCapexItemKeys),z.object({
  quoteId:z.string().trim().min(1).max(100),vendor:z.string().trim().min(1).max(300),item:z.string().trim().min(1).max(500),
  amount,currency:z.string().regex(/^[A-Z]{3}$/),importedAt:z.iso.datetime()
 }).strict()).optional(),
 deal:z.object({
  landMode:z.enum(['transfer','lease','right','purchase']),landValue:amount,landArea:amount,rightValue:amount,
  acquisitionFees:amount.optional(),
  leaseMonth:amount,licenseValue:amount,investorLoan:amount,loanInterest:pct,
  loanYears:z.number().int().min(0).max(60),loanStart:z.number().int().min(0).max(60),
  extraFunding:amount,extraType:z.enum(['loan','equity']),
  appraisalDate:z.iso.date().optional(),appraisalApprovalDate:z.iso.date().optional()
 }).strict(),
 capex:z.object({
  buildings:amount,line:amount,treatment:amount,power:amount,lab:amount,vehicles:amount,
  licenses:amount,others:amount,contingencyPct:multiplier,workingCapital:amount
 }).strict(),
 ops:z.object({
  bottlesHour:amount,hoursDay:amount,daysMonth:amount,bottlesCarton:amount,litersBottle:amount,
  waterLossPct:pct,licensedWaterM3Day:amount,priceCarton:amount,variableCarton:amount,
  fixedMonth:amount,priceGrowth:multiplier,costGrowth:multiplier,fixedGrowth:multiplier,
  maintenancePct:multiplier,nwcPct:multiplier,discountRate:multiplier,taxRate:pct,
  life:z.number().int().min(0).max(60),horizon:z.number().int().min(3).max(10),
  util:z.array(pct).max(10)
 }).strict(),
 operationsPlan:z.object({
  sourceName:z.string().max(160),
  sourceType:z.enum(['well','public-network','spring','other']).optional(),
  permitReference:z.string().max(160),
  packagingLossPct:z.number().finite().min(0).max(99),
  kwhPerThousandBottles:amount,
  cartonsPerTrip:z.number().int().min(0).max(1e12),
  roundTripKm:amount,
  pumpingM3Hour:amount.optional(),
  sourceHoursDay:z.number().finite().min(0).max(24).optional(),
  finishedBottleLossPct:pct.optional(),
  unitCosts:waterUnitCosts.optional(),
  collectionDays:z.number().int().min(0).max(3650).optional(),
  returnsPct:pct.optional(),
  distributionChannel:z.enum(['wholesale','distributors','direct-retail']).optional(),
 }).strict().optional(),
 scenarios:z.array(waterScenarioSchema).max(20)
}).strict();
export type WaterModel=z.infer<typeof waterModelSchema>;
export type WaterScenario=z.infer<typeof waterScenarioSchema>;
export function legacyWaterFinancialPolicy():NonNullable<WaterModel['financialPolicy']>{
 return {workingCapitalMode:'PERCENT',inventoryDays:0,payableDays:0,daysPerYear:365,depreciationMode:'LEGACY',
  assetLives:{},workingCapitalRecoveryPct:0,terminalAssetProceeds:0,evidence:''};
}

export const emptyWaterOperationsPlan:NonNullable<WaterModel['operationsPlan']>={
 sourceName:'',permitReference:'',packagingLossPct:0,kwhPerThousandBottles:0,cartonsPerTrip:0,roundTripKm:0,
};

export function createWaterModel():WaterModel{
 return {
  deal:{landMode:'transfer',landValue:0,landArea:0,rightValue:0,leaseMonth:0,licenseValue:0,
   investorLoan:0,loanInterest:0,loanYears:0,loanStart:0,extraFunding:0,extraType:'loan'},
  capex:{buildings:0,line:0,treatment:0,power:0,lab:0,vehicles:0,licenses:0,others:0,contingencyPct:0,workingCapital:0},
  ops:{bottlesHour:0,hoursDay:0,daysMonth:0,bottlesCarton:0,litersBottle:0,waterLossPct:0,
   licensedWaterM3Day:0,priceCarton:0,variableCarton:0,fixedMonth:0,priceGrowth:0,costGrowth:0,
   fixedGrowth:0,maintenancePct:0,nwcPct:0,discountRate:0,taxRate:0,life:0,horizon:7,util:Array(10).fill(0)},
  scenarios:[
   {name:'Conservative',volume:75,price:95,cost:110},
   {name:'Base',volume:100,price:100,cost:100},
   {name:'Optimistic',volume:120,price:105,cost:98}
  ]
 };
}

const waterRecovery=(lossPct:number)=>Math.max(0.01,1-Math.min(99,lossPct)/100);
const nominalWaterDemand=(ops:WaterModel['ops'])=>
 ops.bottlesHour*ops.hoursDay*ops.litersBottle/(1000*waterRecovery(ops.waterLossPct));

export function evaluateWater(model:WaterModel,scenario?:Omit<WaterScenario,'name'>){
 const effective=effectiveWaterInputs(model),{deal,capex,ops}=effective;
 const hard=capex.buildings+capex.line+capex.treatment+capex.power+capex.lab+capex.vehicles+capex.others;
 const contingency=hard*capex.contingencyPct/100;
 const investment=hard+contingency+capex.licenses;
 const purchaseLand=deal.landMode==='purchase'?deal.landValue+(deal.acquisitionFees??0):0;
 const cashRequired=investment+capex.workingCapital+purchaseLand;
 const land=deal.landMode==='transfer'?deal.landValue:deal.landMode==='right'?deal.rightValue:0;
 const shareholderLoan=Math.min(deal.investorLoan,cashRequired);
 const investorEquity=cashRequired-shareholderLoan+(deal.extraType==='equity'?deal.extraFunding:0);
 const totalEquity=investorEquity+land;
 const totalLoan=shareholderLoan+(deal.extraType==='loan'?deal.extraFunding:0);
 const capacity=ops.bottlesHour*ops.hoursDay*ops.daysMonth*12/Math.max(1,ops.bottlesCarton);
 const waterDemand=nominalWaterDemand(ops);
 const initialPrice=ops.priceCarton*(scenario?.price??100)/100;
 const initialCost=ops.variableCarton*(scenario?.cost??100)/100;
 const returnRate=(model.operationsPlan?.returnsPct??0)/100;
 const finishedYield=model.quantityCosting?.productionEnabled?1-(model.operationsPlan?.finishedBottleLossPct??0)/100:1;
 const dispatchContribution=initialPrice*finishedYield*(1-returnRate)-initialCost;
 const initialFixed=(ops.fixedMonth+deal.leaseMonth)*12;
 const policy=model.financialPolicy,policyState=waterFinancialReadiness(model,capex);
 const maintenance=investment*ops.maintenancePct/100;
 let workingCapital=capex.workingCapital;
 const debtSchedule=waterDebtSchedule(model,totalLoan);
 const annual=Array.from({length:ops.horizon},(_,i)=>{
  const year=i+1;
  const utilization=Math.min(100,(ops.util[i]??ops.util.at(-1)??0)*(scenario?.volume??100)/100);
  const volume=capacity*utilization/100;
  const price=initialPrice*(1+ops.priceGrowth/100)**i;
  const unitCost=initialCost*(1+ops.costGrowth/100)**i;
  const finishedLoss=model.quantityCosting?.productionEnabled?(model.operationsPlan?.finishedBottleLossPct??0)/100:0;
  const saleableVolume=volume*(1-finishedLoss);
  const returnedVolume=saleableVolume*returnRate;
  const netVolume=saleableVolume-returnedVolume;
  const revenue=netVolume*price;
  const variable=volume*unitCost;
  const fixed=initialFixed*(1+ops.fixedGrowth/100)**i;
  const ebitda=revenue-variable-fixed;
  const depreciation=waterAnnualDepreciation(model,capex,year);
  const ebit=ebitda-depreciation;
  const tax=Math.max(0,ebit)*ops.taxRate/100;
  const cycle=waterCashCycle(model,revenue,variable);
  const nextWorkingCapital=policy?.workingCapitalMode==='CYCLE'?cycle.target:revenue*ops.nwcPct/100;
  const workingCapitalMovement=nextWorkingCapital-workingCapital;
  workingCapital=nextWorkingCapital;
  const operatingFreeCashFlow=ebitda-tax-maintenance-workingCapitalMovement;
  const workingCapitalRecovery=year===ops.horizon?nextWorkingCapital*(policy?.workingCapitalRecoveryPct??0)/100:0;
  const terminalAssetProceeds=year===ops.horizon?(policy?.terminalAssetProceeds??0):0;
  const freeCashFlow=operatingFreeCashFlow+workingCapitalRecovery+terminalAssetProceeds;
  const debt=debtSchedule[i],{principal,interest,debtBalance,debtService}=debt;
  // An explicitly selected indicative deduction applies only to paid interest and positive EBIT.
  // Accrued/capitalized interest, loss carryforwards and statutory deduction limits are not assumed.
  const interestTaxSaving=model.financingPolicy?.interestTaxMode==='PAID'?Math.min(Math.max(0,ebit),interest)*ops.taxRate/100:0;
  return {year,utilization,volume,returnedVolume,netVolume,price,unitCost,revenue,variable,fixed,ebitda,depreciation,ebit,tax,
   ...(policy?{receivables:policy.workingCapitalMode==='CYCLE'?cycle.receivables:null,
    inventory:policy.workingCapitalMode==='CYCLE'?cycle.inventory:null,payables:policy.workingCapitalMode==='CYCLE'?cycle.payables:null,
    operatingFreeCashFlow,workingCapitalRecovery,terminalAssetProceeds,closingWorkingCapital:nextWorkingCapital-workingCapitalRecovery}:{}),
   ...(model.financingPolicy?{openingDebt:debt.openingDebt,capitalizedInterest:debt.capitalizedInterest,
    terminalDebtRepayment:debt.terminalDebtRepayment,interestTaxSaving,equityTax:tax-interestTaxSaving}:{}),
   workingCapital,workingCapitalMovement,maintenance,freeCashFlow,principal,interest,debtBalance,debtService,
   afterDebt:freeCashFlow+interestTaxSaving-debtService,dscr:debtService>0?(operatingFreeCashFlow+interestTaxSaving)/debtService:null};
 });
 const flows=[-(cashRequired+land),...annual.map(year=>year.freeCashFlow)];
 const npv=flows.reduce((total,flow,year)=>total+flow/(1+ops.discountRate/100)**year,0);
 let cumulative=flows[0];
 let payback:number|null=null;
 for(const year of annual){
  const previous=cumulative;
  cumulative+=year.freeCashFlow;
  if(previous<0&&cumulative>=0){
   payback=year.year-1-previous/year.freeCashFlow;
   break;
  }
 }
 const financingReadiness=waterFinancingReadiness(model,cashRequired,annual.at(-1)?.debtBalance??totalLoan,totalEquity);
 const equity=model.financingPolicy&&financingReadiness.inputReady?waterEquityReturns({investorEquity,land,shareholderLoan,annual,returnReady:financingReadiness.returnReady}):undefined;
 return {hard,contingency,investment,cashRequired,land,investorEquity,totalEquity,shareholderLoan,totalLoan,
  ...(model.financingPolicy?{financingReadiness,equity}:{}),
  ...(model.quantityCosting||purchaseLand?{purchaseLand,costingReadiness:effective.readiness}:{}),
  ...(policy?{financialReadiness:policyState}:{}),
  investorShare:totalEquity?investorEquity/totalEquity*100:null,partnerShare:totalEquity?land/totalEquity*100:null,
  capacity,waterDemand,annual,flows,npv,cashNpv:npv+land,irr:internalRateOfReturn(flows),payback,
  breakEven:dispatchContribution>0?initialFixed/dispatchContribution:null,
  ready:investment>0&&capacity>0&&ops.bottlesCarton>0&&initialPrice>0&&annual.some(year=>year.netVolume>0)&&(!policy||policyState.inputReady)&&(!model.financingPolicy||financingReadiness.inputReady)};
}

/** Annual steady-state cycle. Receivables use net sales; inventories/payables use variable production cost. */
export function waterCashCycle(model:WaterModel,revenue:number,variable:number){
 const p=model.financialPolicy,days=p?.daysPerYear??365;
 const receivables=revenue*(model.operationsPlan?.collectionDays??0)/days;
 const inventory=variable*(p?.inventoryDays??0)/days,payables=variable*(p?.payableDays??0)/days;
 return {receivables,inventory,payables,target:receivables+inventory-payables};
}

/** Land, working capital and acquisition fees are outside the depreciable investment basis. */
export function waterAnnualDepreciation(model:WaterModel,capex:WaterModel['capex'],year:number){
 const hard=waterCapexItemKeys.filter(k=>k!=='licenses').reduce((s,k)=>s+capex[k],0);
 const reserve=hard*capex.contingencyPct/100,investment=hard+reserve+capex.licenses;
 const mode=model.financialPolicy?.depreciationMode??'LEGACY';
 if(mode==='LEGACY')return investment/Math.max(1,model.ops.life);
 if(mode==='CAPPED')return model.ops.life>0&&year<=model.ops.life?investment/model.ops.life:0;
 return waterCapexItemKeys.reduce((s,key)=>{
  const life=model.financialPolicy?.assetLives[key];
  const basis=capex[key]+(key!=='licenses'&&hard>0?reserve*capex[key]/hard:0);
  return s+(life&&year<=life?basis/life:0);
 },0);
}

export function waterFinancialReadiness(model:WaterModel,capex:WaterModel['capex']=effectiveWaterInputs(model).capex){
 const p=model.financialPolicy,mode=p?.depreciationMode??'LEGACY';
 const hasInvestment=waterCapexItemKeys.some(k=>capex[k]>0);
 const inputIssues=[
  ...(hasInvestment&&mode!=='CLASSES'&&model.ops.life<=0?['DEPRECIATION_LIFE']:[]),
  ...(hasInvestment&&mode==='LEGACY'&&model.ops.life>0&&model.ops.horizon>model.ops.life?['LEGACY_OVERDEPRECIATION']:[]),
  ...(mode==='CLASSES'?waterCapexItemKeys.filter(k=>capex[k]>0&&!p?.assetLives[k]).map(k=>'ASSET_LIFE:'+k):[]),
  ...(p?.workingCapitalMode==='CYCLE'&&model.operationsPlan?.collectionDays===undefined?['COLLECTION_DAYS']:[]),
  ...(p?.workingCapitalMode==='CYCLE'&&Math.max(model.operationsPlan?.collectionDays??0,p.inventoryDays,p.payableDays)>p.daysPerYear?['CYCLE_HORIZON']:[]),
 ];
 const evidenceIssues=p&&!p.evidence.trim()?['FINANCE_EVIDENCE']:[];
 const inputReady=inputIssues.every(code=>mode==='LEGACY'&&['DEPRECIATION_LIFE','LEGACY_OVERDEPRECIATION'].includes(code));
 return {inputReady,ready:inputIssues.length===0&&evidenceIssues.length===0,issues:[...inputIssues,...evidenceIssues]};
}

export function effectiveWaterInputs(model:WaterModel){
 const q=model.quantityCosting,context={LAND_AREA:model.deal.landArea,BUILT_AREA:q?.builtArea??0,CAPACITY:model.ops.bottlesHour};
 const capital=evaluateQuantityBudget(q?.capital,context),fixed=evaluateQuantityBudget(q?.fixed,context);
 const capex={...model.capex};
 if(q?.capital.enabled){
  for(const key of waterCapexItemKeys)capex[key]=capital.rows.filter(x=>x.category===key).reduce((s,x)=>s+x.total,0);
 }
 const material=waterVariableCostBreakdown(model);
 const ops={...model.ops,...(q?.fixed.enabled?{fixedMonth:fixed.total}:{}),...(q?.materialsEnabled?{variableCarton:material?.total??0}:{})};
 const deal={...model.deal,...(q?.landByArea?{landValue:model.deal.landArea*q.landUnitPrice}:{})};
 const blockers=[...capital.blockers,...fixed.blockers,
  ...(q?.capital.enabled?capital.rows.filter(x=>!waterCapexItemKeys.includes(x.category as WaterCapexItemKey)).map(x=>'CATEGORY:'+x.id):[]),
  ...(q?.materialsEnabled&&(!material||material.total<=0||!q.materialSource.trim())?['MATERIAL_INPUTS']:[]),
  ...(q?.landByArea&&(!(deal.landValue>0)||!q.landSource.trim())?['LAND_VALUATION']:[]),
  ...(q?.landByArea&&(!Number.isFinite(deal.landValue)||deal.landValue>1e12)?['LAND_LIMIT']:[]),
  ...(q?.productionEnabled&&(!model.operationsPlan?.sourceName.trim()||!model.operationsPlan.sourceType||!model.operationsPlan?.permitReference.trim()||model.ops.licensedWaterM3Day<=0)?['WATER_SOURCE_EVIDENCE']:[]),
  ...(q?.productionEnabled&&(['well','spring'].includes(model.operationsPlan?.sourceType??''))&&(!(model.operationsPlan?.pumpingM3Hour??0)||!(model.operationsPlan?.sourceHoursDay??0))?['PUMP_INPUTS']:[]),
  ...(q?.productionEnabled&&(model.ops.hoursDay>24||model.ops.hoursDay<=0||model.ops.daysMonth>31||model.ops.daysMonth<=0||model.ops.litersBottle<=0||model.ops.waterLossPct>=100)?['OPERATING_INPUTS']:[]),
  ...(q?.productionEnabled&&nominalWaterDemand(model.ops)>model.ops.licensedWaterM3Day?['LICENSED_WATER_CAPACITY']:[]),
  ...(q?.productionEnabled&&model.operationsPlan?.pumpingM3Hour&&model.operationsPlan.sourceHoursDay&&nominalWaterDemand(model.ops)>model.operationsPlan.pumpingM3Hour*model.operationsPlan.sourceHoursDay?['PUMP_CAPACITY']:[]),
 ];
 return {deal,capex,ops,capital,fixed,material,readiness:{ready:blockers.length===0,blockers}};
}

export function waterProductionBalance(model:WaterModel){
 const {ops,operationsPlan:plan}=model;
 const pumpedM3Day=plan?.pumpingM3Hour&&plan.sourceHoursDay
  ?plan.pumpingM3Hour*plan.sourceHoursDay:null;
 const licensedM3Day=ops.licensedWaterM3Day||null;
 const availableM3Day=pumpedM3Day!==null&&licensedM3Day!==null
  ?Math.min(pumpedM3Day,licensedM3Day):null;
 const requiredM3Day=nominalWaterDemand(ops);
 const nominalBottles=ops.bottlesHour*ops.hoursDay*ops.daysMonth;
 const finishedWaste=nominalBottles*(plan?.finishedBottleLossPct??0)/100;
 const saleableBottles=nominalBottles-finishedWaste;
 return {pumpedM3Day,licensedM3Day,availableM3Day,requiredM3Day,nominalBottles,finishedWaste,saleableBottles,
  saleableCartons:ops.bottlesCarton>0?Math.floor(saleableBottles/ops.bottlesCarton):null};
}

export function waterOperationalRequirements(
 model:WaterModel,year:Pick<ReturnType<typeof evaluateWater>['annual'][number],'volume'>
){
 if(model.ops.bottlesCarton<=0)return null;
 const plan=model.operationsPlan??emptyWaterOperationsPlan;
 const cartons=year.volume;
 const bottles=cartons*model.ops.bottlesCarton;
 const filledLitres=model.ops.litersBottle>0?bottles*model.ops.litersBottle:null;
 const packagingYield=1-plan.packagingLossPct/100;
 const trips=plan.cartonsPerTrip>0?Math.ceil(cartons/plan.cartonsPerTrip):null;
 return {
  bottles,filledLitres,
  sourceWaterM3:filledLitres===null?null:filledLitres/(1000*waterRecovery(model.ops.waterLossPct)),
  bottleInputs:Math.ceil(bottles/packagingYield),
  cartonInputs:Math.ceil(cartons/packagingYield),
  electricityKwh:plan.kwhPerThousandBottles>0?bottles/1000*plan.kwhPerThousandBottles:null,
  trips,
  distributionKm:trips!==null&&plan.roundTripKm>0?trips*plan.roundTripKm:null,
 };
}

export function waterVariableCostBreakdown(model:WaterModel){
 const plan=model.operationsPlan;
 if(!plan?.unitCosts||model.ops.bottlesCarton<=0)return null;
 const units=plan.unitCosts;
 const {bottlesCarton,litersBottle,waterLossPct}=model.ops;
 const yieldRate=1-plan.packagingLossPct/100;
 const packaging=((units.bottle+units.cap+units.label)*bottlesCarton+units.carton)/yieldRate;
 const electricity=bottlesCarton*plan.kwhPerThousandBottles/1000*units.kwh;
 const water=bottlesCarton*litersBottle/(1000*waterRecovery(waterLossPct))*units.rawWaterM3;
 const distribution=plan.cartonsPerTrip>0?plan.roundTripKm/plan.cartonsPerTrip*units.distributionKm:0;
 return {packaging,electricity,water,distribution,total:packaging+electricity+water+distribution};
}

export function studyReportReadiness(study:FeasibilityStudy){
 return {
  openCritical:study.legal.filter(item=>item.critical&&item.status!=='VERIFIED'),
  openTasks:study.tasks.filter(item=>item.status!=='DONE'),
  highRisks:study.risks.filter(item=>item.status!=='MITIGATED'&&item.impact*item.likelihood>=15)
 };
}
