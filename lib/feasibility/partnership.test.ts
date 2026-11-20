import {expect,it} from 'vitest';
import {createStudy,evaluateStudy} from './engine';
import {cloudDraftWrite} from './draft-schema';
import {emptyAdvanced,evaluateAdvanced,illustratedLives} from './advanced-model';
import {evaluateMonthlyLiquidity,defaultMonthlyLiquidity,monthlyLiquidityAmounts} from './monthly-liquidity';
import {summarizePartnership,type Partnership} from './partnership';
import {createRawLand,evaluateRawLand} from './raw-land';
import {createWaterModel,evaluateWater} from './water-model';

const id='3cadcbaa-e175-453a-9822-83dede84ef3d';
const partners:Partnership={asOf:'2026-11-20',landPartnerId:id,partners:[
 {id,name:'A',ownershipPct:50,profitPct:35,cashCommitted:100,cashPaid:80,loanPaid:30},
 {id:'fcd5f1ab-2350-4adc-988c-069c61579783',name:'B',ownershipPct:30,profitPct:45,cashCommitted:300,cashPaid:200,loanPaid:0},
 {id:'ef9f4df1-d053-4c01-a65f-7d87356708da',name:'C',ownershipPct:20,profitPct:20,cashCommitted:0,cashPaid:0,loanPaid:50}
]};

it('saves three partners and validates ownership, profit, commitments and cash separately',()=>{
 const study={...createStudy(id,'Synthetic'),partnership:partners};
 expect(cloudDraftWrite.parse({study}).study.partnership).toEqual(partners);
 expect(summarizePartnership(partners)).toMatchObject({cashPaid:280,loanPaid:80,committed:400,outstanding:120,
  ownershipBalanced:true,profitBalanced:true});
 expect(summarizePartnership({...partners,partners:partners.partners.map(p=>({...p,profitPct:0}))})).toMatchObject({
  ownershipBalanced:true,profitBalanced:false});
 expect(cloudDraftWrite.safeParse({study:{...study,partnership:{...partners,partners:[...partners.partners,partners.partners[0]]}}}).success).toBe(false);
 expect(cloudDraftWrite.safeParse({study:{...study,partnership:{...partners,partners:partners.partners.slice(1)}}}).success).toBe(false);
});

it('keeps legacy in-kind value and assigns the prospective land cost to a single category',()=>{
 const study={...createStudy(id,'Synthetic'),landTransferred:true,landValue:500,monthlyUnits:100,
  unitPrice:4,variableCost:1,monthlyFixedCost:10,workingCapital:100};
 study.capex[0].amount=1000;
 expect(evaluateStudy(study)).toMatchObject({landAsset:500,cashInvestment:1100,totalInvestment:1600});
 const lease={...study,landArrangement:{mode:'LEASE' as const,monthlyRent:50}};
 const buy={...study,landArrangement:{mode:'PURCHASE' as const,price:500,fees:50}};
 const gift={...study,landArrangement:{mode:'IN_KIND' as const,valuation:700}};
 const leased=evaluateStudy(lease);
 expect(leased).toMatchObject({landAsset:0,cashInvestment:1100});
 expect(leased.annual[0].fixed).toBe(720);
 expect(evaluateStudy(buy)).toMatchObject({landAsset:0,cashInvestment:1650,totalInvestment:1650,cashFundingGap:1650});
 expect(evaluateStudy(gift)).toMatchObject({landAsset:700,cashInvestment:1100,totalInvestment:1800});
 const advanced={...buy,advanced:{...emptyAdvanced(),lives:{...illustratedLives}}};
 expect(evaluateAdvanced(advanced)).toMatchObject({ready:true,cashNeed:1650,initialInvestment:1650});
 expect(evaluateMonthlyLiquidity(monthlyLiquidityAmounts(advanced)!,defaultMonthlyLiquidity).rows[0].investment).toBe(-1650);
});

it('charges raw land rent as recurring cash and excludes purchase value and acquisition fees',()=>{
 const rawLand=createRawLand();
 Object.assign(rawLand.site,{areaAfterPriorTransfers:1000,landPricePerNetSqm:8,landPaymentMethod:'lease',annualLandRent:300});
 rawLand.sales.mix[0].price=20;
 rawLand.cost.landAcquisitionFees=100;
 const result=evaluateRawLand(rawLand);
 if(result.issue)throw new Error(result.issue);
 expect(result).toMatchObject({land:0,cashDevelopmentCost:1200});
 expect(result.annual.map(row=>row.cashCost)).toEqual([300,300,300,300]);
 const amounts=monthlyLiquidityAmounts({...createStudy(id,'Land','REAL_ESTATE'),rawLand})!;
 expect(amounts).toMatchObject({investment:0,costs:-300});
});

it('preserves the water model’s land lease, purchase and in-kind cash classifications',()=>{
 const water=createWaterModel();
 water.capex.line=1000;
 Object.assign(water.deal,{landMode:'lease',landValue:500,leaseMonth:50});
 expect(evaluateWater(water)).toMatchObject({cashRequired:1000,land:0});
 expect(evaluateWater(water).annual[0].fixed).toBe(600);
 Object.assign(water.deal,{landMode:'purchase',leaseMonth:0,acquisitionFees:50});
 expect(evaluateWater(water)).toMatchObject({cashRequired:1550,land:0});
 water.deal.landMode='transfer';
 expect(evaluateWater(water)).toMatchObject({cashRequired:1000,land:500});
});

it('uses actual and rescheduled partner payments once, keeping external borrowing',()=>{
 const study={...createStudy(id,'Installments'),investorEquity:600,investorLoan:200,otherDebt:50};
 study.capex[0].amount=1000;
 const alpha={...partners.partners[0],cashCommitted:900,cashPaid:750,loanPaid:600,installments:[
  {id,type:'EQUITY' as const,amount:600,expectedOn:'2026-12-01',revisedOn:'2027-03-15',paid:300,paidOn:'2026-12-20'},
  {id:partners.partners[1].id,type:'LOAN' as const,amount:200,expectedOn:'2027-02-03',paid:0},
  {id:partners.partners[2].id,type:'EQUITY' as const,amount:150,expectedOn:'2026-12-01',paid:0}
 ]};
 const partnership={partners:[alpha],asOf:'2027-01-15'};
 const amounts=monthlyLiquidityAmounts(study)!;
 const plan={...defaultMonthlyLiquidity,startMonth:'2026-12',cashEquity:900,usePartnerInstallments:true};
 const schedule=evaluateMonthlyLiquidity(amounts,plan,partnership);
 expect(summarizePartnership(partnership)).toMatchObject({cashPaid:300,loanPaid:0,outstanding:600});
 expect(schedule.rows[0]).toMatchObject({equity:300,debtDraw:50,closing:-650});
 expect(schedule.rows[2]).toMatchObject({equity:0,debtDraw:200,closing:-450});
 expect(schedule.rows[3]).toMatchObject({equity:300,debtDraw:0,closing:-150});
 expect(schedule).toMatchObject({fundingGap:650,peakMonth:1,partnerFunding:{overdue:150,scheduledLoan:200}});
 expect(cloudDraftWrite.parse({study:{...study,partnership,monthlyLiquidity:plan}}).study.partnership).toEqual(partnership);
});

it('puts payments outside the forecast window or without reliable dates in neither opening cash nor monthly receipts',()=>{
 const installment={id,type:'EQUITY' as const,amount:300,expectedOn:'2027-01-01',paid:100,paidOn:'2027-01-01'};
 const partnership={asOf:'2027-02-01',partners:[
  {...partners.partners[0],installments:[installment,{...installment,id:partners.partners[1].id,amount:40,paid:40,paidOn:'2027-08-01'},
   {...installment,id:partners.partners[2].id,amount:50,paid:50,paidOn:undefined}]},
  partners.partners[1]
 ]};
 const study=createStudy(id,'Outside window');
 const schedule=evaluateMonthlyLiquidity(monthlyLiquidityAmounts(study)!,{
  ...defaultMonthlyLiquidity,startMonth:'2027-02',usePartnerInstallments:true
 },partnership);
 expect(schedule.partnerFunding).toMatchObject({beforeWindow:100,overdue:200,undated:50,futureActual:40,undatedLegacy:200});
 expect(schedule.rows.every(row=>row.equity===0)).toBe(true);
});
