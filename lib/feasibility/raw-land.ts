import {z} from 'zod';
import {internalRateOfReturn} from './engine';
import {landDistributionSchema} from './raw-land-distributions';
import {quantityBudgetSchema,evaluateQuantityBudget} from './quantity-costs';

const amount=z.number().min(0).max(1e12);
const ratio=z.number().min(0).max(1);
const rate=z.number().min(-1).max(10);
const shortText=z.string().max(300);
const phases=z.tuple([ratio,ratio,ratio,ratio]);
const costPhases={
 development:phases,studies:phases,developerFee:phases,marketing:phases,fundSetup:phases,
 fundMgmt:phases,interestBudget:phases,arrangement:phases,contingency:phases,otherCosts:phases
};
const legacyReferenceSchema=z.object({
 structure:shortText,
 additionalConstraints:amount,
 partners:z.array(z.object({
  name:shortText,contributionType:shortText,contribution:amount,profitShare:ratio,role:shortText
 }).strict()).max(50),
 developmentAllocation:z.array(z.object({name:shortText,share:ratio}).strict()).max(100),
 absorption:z.array(z.object({name:shortText,phasing:phases}).strict()).max(20)
}).strict();
export const rawLandSchema=z.object({
 quantityDevelopment:z.object({budget:quantityBudgetSchema,roadLength:amount,networkLength:amount,serviceArea:amount,
  serviceAreaFromSite:z.boolean().optional(),assumptionSource:z.string().max(3000).optional(),landTiming:z.enum(['YEAR1','YEAR0']).optional(),committedEquity:amount.optional()}).strict().optional(),
 project:z.object({startYear:z.number().int().min(1900).max(2200),years:z.number().int().min(1).max(15),discountRate:ratio}).strict(),
 site:z.object({areaAfterPriorTransfers:amount,excludedValley:amount,extraExcluded:amount,otherConstraintsSqm:amount,
  serviceRatio:ratio,landPricePerNetSqm:amount,landPaymentMethod:z.enum(['in_kind','cash','lease']),annualLandRent:amount.optional(),
  acquisitionBasis:z.enum(['NET','GROSS','MANUAL']).optional(),acquisitionArea:amount.optional(),
  priorTransferDescription:z.string().max(5000),valuationDate:z.union([z.literal(''),z.iso.date()]),appraiser:shortText}).strict(),
 cost:z.object({developmentPerNetSqm:amount,studies:amount,developerFeeRate:ratio,developerFeeBase:z.enum(['development','dev_plus_studies']),
  marketingRate:ratio,marketingMode:z.enum(['reference','scenario']),marketingReferenceRevenue:amount,
  fundSetupRate:ratio,fundMgmtBase:amount,fundMgmtRatePerYear:ratio,fundMgmtYears:z.number().int().min(0).max(15),
  contingencyRate:ratio,otherCosts:amount,taxes:amount,landAcquisitionFees:amount,
  developmentItems:z.array(z.object({name:shortText,quantity:amount,unitCost:amount}).strict()).max(100).optional()}).strict(),
 finance:z.object({facility:amount,benchmarkRate:ratio,spreadRate:ratio,interestBudgetRate:ratio,arrangementRate:ratio,
  interestMode:z.enum(['reference','dynamic']),loanDrawFirstYear:ratio}).strict(),
 sales:z.object({priceMode:z.enum(['reference','compound']),
  mix:z.array(z.object({name:shortText,share:ratio,price:amount,enabled:z.boolean(),annualGrowthAdjustment:rate,
   salesPhasing:phases.optional(),collectionPhasing:phases.optional()}).strict()).max(20),
  scenarios:z.array(z.object({name:shortText,priceMultiplier:amount.max(10),annualGrowth:rate,
   initialPricePremium:rate,costMultiplier:amount.max(10),salesDelayYears:z.number().int().min(0).max(3)}).strict()).min(1).max(12)
 }).strict(),
 phasing:z.object({sales:phases,...costPhases}).strict(),
 waterfall:z.object({incentiveRate:ratio,hurdleRate:ratio,hurdleBase:z.enum(['revenue','cost']),
  developerIncentiveShare:ratio}).strict(),
 distribution:landDistributionSchema.optional(),
 legacyReference:legacyReferenceSchema.optional()
}).strict();
export type RawLand=z.infer<typeof rawLandSchema>;
type Phase=RawLand['phasing']['sales'];
const uniform=():Phase=>[.25,.25,.25,.25];
export const rawLandCostKeys=['development','studies','developerFee','marketing','fundSetup','fundMgmt','interestBudget','arrangement','contingency','otherCosts'] as const;

export function createRawLand():RawLand{
 return {
  project:{startYear:new Date().getFullYear(),years:4,discountRate:0},
  site:{areaAfterPriorTransfers:0,excludedValley:0,extraExcluded:0,otherConstraintsSqm:0,serviceRatio:0,landPricePerNetSqm:0,
   landPaymentMethod:'in_kind',priorTransferDescription:'',valuationDate:'',appraiser:''},
  cost:{developmentPerNetSqm:0,studies:0,developerFeeRate:0,developerFeeBase:'dev_plus_studies',
   marketingRate:0,marketingMode:'scenario',marketingReferenceRevenue:0,fundSetupRate:0,fundMgmtBase:0,
   fundMgmtRatePerYear:0,fundMgmtYears:0,contingencyRate:0,otherCosts:0,taxes:0,landAcquisitionFees:0},
  finance:{facility:0,benchmarkRate:0,spreadRate:0,interestBudgetRate:0,arrangementRate:0,interestMode:'reference',loanDrawFirstYear:.5},
  sales:{priceMode:'compound',mix:[{name:'',share:1,price:0,enabled:true,annualGrowthAdjustment:0}],
   scenarios:['Cautious','Conservative','Base','Optimistic'].map(name=>({name,priceMultiplier:1,annualGrowth:0,initialPricePremium:0,costMultiplier:1,salesDelayYears:0}))},
  phasing:{sales:uniform(),development:uniform(),studies:[1,0,0,0],developerFee:uniform(),marketing:uniform(),
   fundSetup:[1,0,0,0],fundMgmt:uniform(),interestBudget:uniform(),arrangement:uniform(),contingency:uniform(),otherCosts:uniform()},
  waterfall:{incentiveRate:0,hurdleRate:0,hurdleBase:'revenue',developerIncentiveShare:0}
 };
}

const sum=(values:readonly number[])=>values.reduce((a,b)=>a+b,0);
const one=(value:number)=>Math.abs(value-1)<=1e-8;
function singleSignChangeIrr(flows:number[]){
 const nonzero=flows.filter(value=>value!==0);
 const signChanges=nonzero.filter((value,i)=>i>0&&Math.sign(value)!==Math.sign(nonzero[i-1])).length;
 return signChanges===1?internalRateOfReturn(flows):null;
}
export function annualPhaseWeights(phase:Phase,yearCount:number,delay=0,horizon=yearCount+delay){
 const cumulative=(time:number)=>sum(phase.map((weight,i)=>weight*Math.max(0,Math.min(1,4*time-i))));
 return Array.from({length:horizon},(_,i)=>Math.max(0,cumulative((i+1-delay)/yearCount)-cumulative((i-delay)/yearCount)));
}

export function evaluateRawLand(model:RawLand,scenarioIndex=2){
 const {project,site,cost,finance,sales,phasing,waterfall}=model;
 const scenario=sales.scenarios[scenarioIndex]??sales.scenarios[0];
 const uses=sales.mix.filter(use=>use.enabled);
 const excluded=site.excludedValley+site.extraExcluded+site.otherConstraintsSqm;
 const net=Math.max(0,site.areaAfterPriorTransfers-excluded);
 const saleArea=net*(1-site.serviceRatio);
 const shareTotal=sum(uses.map(use=>use.share));
 const invalidPhases=[...Object.entries(phasing).filter(([,phase])=>!one(sum(phase))).map(([key])=>key),
  ...(model.quantityDevelopment?.budget.enabled?model.quantityDevelopment.budget.items.filter(x=>x.phasing&&!one(sum(x.phasing))).map(x=>'quantity_'+x.id):[])];
 const invalidUsePhases=uses.some(use=>[use.salesPhasing,use.collectionPhasing].some(phase=>phase&&!one(sum(phase))));
 const validGrowth=uses.every(use=>scenario.annualGrowth+use.annualGrowthAdjustment>=-1);
 const issue=excluded>site.areaAfterPriorTransfers?'area':!one(shareTotal)?'mix':invalidPhases.length||invalidUsePhases?'phasing':
  sales.priceMode==='compound'&&!validGrowth?'growth':null;
 if(issue)return {issue,net,saleArea,shareTotal,invalidPhases} as const;
 const acquisitionArea=site.acquisitionBasis==='GROSS'?site.areaAfterPriorTransfers:site.acquisitionBasis==='MANUAL'?(site.acquisitionArea??0):net;
 const leased=site.landPaymentMethod==='lease';
 const land=leased?0:acquisitionArea*site.landPricePerNetSqm;
 const annualLandRent=leased?site.annualLandRent??0:0;
 const quantity=evaluateQuantityBudget(model.quantityDevelopment?.budget,{LAND_AREA:site.areaAfterPriorTransfers,NET_AREA:net,SALE_AREA:saleArea,
  ROAD_LENGTH:model.quantityDevelopment?.roadLength??0,NETWORK_LENGTH:model.quantityDevelopment?.networkLength??0,
  SERVICE_AREA:model.quantityDevelopment?.serviceAreaFromSite?net*site.serviceRatio:model.quantityDevelopment?.serviceArea??0});
 const developmentBase=model.quantityDevelopment?.budget.enabled?quantity.total:cost.developmentItems?.length
  ?sum(cost.developmentItems.map(item=>item.quantity*item.unitCost))
  :net*cost.developmentPerNetSqm;
 const development=developmentBase*scenario.costMultiplier;
 const studies=cost.studies;
 const saleYears=project.years+scenario.salesDelayYears;
 const scheduledUses=uses.map(use=>({
  ...use,
  weights:annualPhaseWeights(use.salesPhasing??phasing.sales,project.years,scenario.salesDelayYears),
  collection:use.collectionPhasing??[1,0,0,0]
 }));
 const pricedUses=scheduledUses.filter(use=>use.share>0&&use.price>0);
 const hasInstalments=pricedUses.some(use=>use.collection.slice(1).some(weight=>weight>0));
 const years=Math.max(saleYears,...pricedUses.map(use=>{
  const closingSale=use.weights.reduce((last,weight,index)=>weight>0?index:last,0);
  const closingLag=use.collection.reduce((last,weight,index)=>weight>0?index:last,0);
  return closingSale+closingLag+1;
 }));
 const annualSales=Array<number>(years).fill(0);
 const collections=Array<number>(years).fill(0);
 const saleWeights=Array<number>(years).fill(0);
 for(const use of scheduledUses){
  use.weights.forEach((weight,year)=>{
   const factor=sales.priceMode==='reference'?scenario.priceMultiplier:
    (1+scenario.initialPricePremium)*(1+scenario.annualGrowth+use.annualGrowthAdjustment)**year;
   const areaWeight=use.share*weight;
   const value=saleArea*areaWeight*use.price*factor;
   saleWeights[year]+=areaWeight;
   annualSales[year]+=value;
   use.collection.forEach((portion,lag)=>{
    if(portion>0&&value!==0)collections[year+lag]+=value*portion;
   });
  });
 }
 const revenue=sum(annualSales);
 const costs={
  development,studies,
  developerFee:(development+(cost.developerFeeBase==='dev_plus_studies'?studies:0))*cost.developerFeeRate,
  marketing:cost.marketingRate*(cost.marketingMode==='reference'?cost.marketingReferenceRevenue:revenue),
  fundSetup:land*cost.fundSetupRate,
  fundMgmt:cost.fundMgmtBase*cost.fundMgmtRatePerYear*Math.min(project.years,cost.fundMgmtYears),
  interestBudget:finance.facility*finance.interestBudgetRate,
  arrangement:finance.facility*finance.arrangementRate,
  contingency:(development+studies)*cost.contingencyRate,
  otherCosts:cost.otherCosts+cost.taxes+(leased?0:cost.landAcquisitionFees)
 };
 const weights=Object.fromEntries(rawLandCostKeys.map(key=>[key,annualPhaseWeights(phasing[key],project.years,0,years)])) as Record<(typeof rawLandCostKeys)[number],number[]>;
 if(model.quantityDevelopment?.budget.enabled&&developmentBase>0){
  weights.development=Array.from({length:years},(_,i)=>quantity.rows.reduce((s,item)=>
   s+item.total/developmentBase*annualPhaseWeights(item.phasing??phasing.development,project.years,0,years)[i],0));
 }
 let debt=0,repaymentDue=0;
 const repayFromCollections=Boolean(model.quantityDevelopment?.budget.enabled||hasInstalments);
 const allocations=annualSales.map((salesValue,i)=>{
  const draw=finance.facility*(saleYears===1?1:i===0?finance.loanDrawFirstYear:i===1?1-finance.loanDrawFirstYear:0);
  const repayWeight=repayFromCollections?(revenue>0?collections[i]/revenue:0):saleWeights[i];
  const scheduledRepayment=finance.facility*repayWeight;
  // A collection may precede a staged draw. Carry the unpaid target forward
  // so the detailed schedule can repay the later borrowing from retained cash.
  repaymentDue=(repayFromCollections?repaymentDue:0)+scheduledRepayment;
  const repayment=Math.min(debt+draw,repaymentDue);
  repaymentDue-=repayment;
  const interest=finance.interestMode==='reference'?costs.interestBudget*weights.interestBudget[i]:
   (debt+.5*(draw-repayment))*(finance.benchmarkRate+finance.spreadRate);
  debt+=draw-repayment;
  return {salesValue,cashCollected:collections[i],draw,repayment,interest,closingDebt:debt};
 });
 costs.interestBudget=sum(allocations.map(row=>row.interest));
 const cashDevelopmentCost=sum(Object.values(costs))+annualLandRent*years;
 const totalCost=land+cashDevelopmentCost;
 const gross=revenue-totalCost;
 const incentiveAtCost=(basis:number)=>{
  const hurdle=(waterfall.hurdleBase==='revenue'?revenue:basis)*waterfall.hurdleRate;
  return Math.max(0,revenue-basis-hurdle)*waterfall.incentiveRate;
 };
 const incentive=incentiveAtCost(totalCost);
 const profit=gross-incentive;
 const landAtStart=model.quantityDevelopment?.landTiming==='YEAR0';
 const initialProject=landAtStart?-land:0,initialEquity=landAtStart&&site.landPaymentMethod==='cash'?-land:0;
 let cumulativeOperating=0,cumulativeProject=initialProject,cumulativeEquity=initialEquity;
 let receivables=0;
 const annual=allocations.map((row,i)=>{
  const cashCost=annualLandRent+row.interest+sum(rawLandCostKeys.filter(key=>key!=='interestBudget').map(key=>costs[key]*weights[key][i]));
  receivables+=row.salesValue-row.cashCollected;
  const operatingCash=row.cashCollected-cashCost;
  const performanceFee=i===years-1?incentive:0;
  const projectCash=operatingCash-performanceFee-(i===0&&!landAtStart?land:0);
  const equityCash=operatingCash-performanceFee+row.draw-row.repayment-(i===0&&!landAtStart&&site.landPaymentMethod==='cash'?land:0);
  cumulativeOperating+=operatingCash;cumulativeProject+=projectCash;cumulativeEquity+=equityCash;
  return {...row,receivables:Math.max(0,receivables),year:project.startYear+i,soldArea:saleArea*saleWeights[i],cashCost,operatingCash,performanceFee,projectCash,
   equityCash,cumulativeOperating,cumulativeProject,cumulativeEquity};
 });
 const npv=initialProject+sum(annual.map((row,i)=>row.projectCash/(1+project.discountRate)**(i+1)));
 const ready=saleArea>0&&revenue>0&&totalCost>0;
 const projectFlows=landAtStart?[initialProject,...annual.map(row=>row.projectCash)]:annual.map(row=>row.projectCash);
 const irr=ready?singleSignChangeIrr(projectFlows):null;
 let returns;
 if(landAtStart&&ready){
  const unleveredIncentive=incentiveAtCost(totalCost-costs.interestBudget-costs.arrangement);
  const unleveredFlows=[initialProject,...annual.map((row,i)=>
   row.operatingCash+row.interest+costs.arrangement*weights.arrangement[i]-(i===years-1?unleveredIncentive:0))];
  // Total economic equity includes the land at year zero, whether purchased
  // for cash or contributed in kind. It is not a return for a specific partner.
  const equityFlows=[initialProject,...annual.map(row=>row.equityCash)];
  const investmentIrr=(flows:number[])=>(flows.find(value=>value!==0)??0)<0?singleSignChangeIrr(flows):null;
  returns={
   unleveredFlows,equityFlows,unleveredIrr:investmentIrr(unleveredFlows),
   unleveredNpv:sum(unleveredFlows.map((value,i)=>value/(1+project.discountRate)**i)),
   equityIrr:(annual.at(-1)?.closingDebt??0)<=.01?investmentIrr(equityFlows):null,
  };
 }
 let cumulative=initialProject,payback:number|null=null;
 if(landAtStart)for(const [i,row] of annual.entries()){
  const prior=cumulative;cumulative+=row.projectCash;
  if(prior<0&&cumulative>=0){payback=i-prior/row.projectCash;break;}
 }
 return {issue:null,ready,net,saleArea,land,revenue,costs,cashDevelopmentCost,totalCost,gross,incentive,
  ...(model.quantityDevelopment||site.acquisitionBasis?{acquisitionArea,quantityReadiness:{ready:quantity.ready,blockers:quantity.blockers},
   financeMetrics:{initialProject,initialEquity,projectFlows,payback,returns,dscr:annual.map(row=>row.interest+row.repayment>0?
    (row.cashCollected-row.cashCost+row.interest-row.performanceFee)/(row.interest+row.repayment):null)}}:{}),
  developerIncentive:incentive*waterfall.developerIncentiveShare,
  managerIncentive:incentive*(1-waterfall.developerIncentiveShare),profit,npv,irr,
  roiLand:land>0?profit/land:null,roiCost:totalCost>0?profit/totalCost:null,
  margin:revenue>0?profit/revenue:null,averagePrice:saleArea>0?revenue/saleArea:null,
  breakEven:saleArea>0?totalCost/saleArea:null,
  peakCashDeficit:Math.max(0,-Math.min(...annual.map(row=>row.cumulativeOperating))),
  peakEquityDeficit:Math.max(0,-Math.min(initialEquity,...annual.map(row=>row.cumulativeEquity))),annual} as const;
}
