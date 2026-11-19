import {z} from 'zod';
import {rawLandSchema} from './raw-land';
import {waterModelSchema} from './water-model';
const amount=z.number().finite().min(0).max(1000000000000);
const percent=z.number().finite().min(0).max(100000);
const text=z.string().max(5000);
const sector=z.enum(['INDUSTRIAL','COMMERCIAL','REAL_ESTATE','SERVICES','AGRICULTURE','CUSTOM']);
const date=z.string().datetime();
const scenarioFactor=z.number().finite().min(0).max(1000);
const scenarioFactors=z.object({volume:scenarioFactor,price:scenarioFactor,variable:scenarioFactor}).strict();
export const feasibilityDraftSchema=z.object({
 id:z.string().uuid(),title:z.string().trim().min(1).max(300),sector,
 country:z.string().trim().max(120),region:z.string().max(150),
 legalOwner:z.string().trim().max(300).optional(),siteDescription:z.string().trim().max(500).optional(),
 studyType:z.enum(['NEW_PROJECT','EXPANSION','ACQUISITION']).optional(),
 projectStartYear:z.number().int().min(1900).max(2200).optional(),siteAreaM2:amount.optional(),
 // An empty country/currency is allowed for a draft, but blocks project-readiness approval.
 currency:z.string().regex(/^(?:[A-Z]{3})?$/),
 status:z.enum(['IDEA','FEASIBILITY','APPROVED','ESTABLISHMENT','OPERATING','CANCELLED']),
 landValue:amount,landTransferred:z.boolean(),investorEquity:amount,partnerCashEquity:amount,
 investorLoan:amount,otherDebt:amount,workingCapital:amount,annualMaintenance:amount,
 unitPrice:amount,variableCost:amount,monthlyUnits:amount,monthlyFixedCost:amount,
 volumeGrowthPct:percent,priceGrowthPct:percent,fixedCostGrowthPct:percent,discountRatePct:percent,indicativeTaxRatePct:percent,
 years:z.number().int().min(1).max(20),
 scenarioAssumptions:z.object({CONSERVATIVE:scenarioFactors.optional(),BASE:scenarioFactors.optional(),OPTIMISTIC:scenarioFactors.optional()}).strict().optional(),
 capex:z.array(z.object({id:z.string().max(100),label:z.string().max(300),amount,category:z.enum(['BUILDINGS','EQUIPMENT','UTILITIES','LICENCES','OTHER'])})).max(500),
 tasks:z.array(z.object({id:z.string().max(100),title:z.string().max(400),owner:z.string().max(300),due:z.string().max(30),status:z.enum(['TODO','IN_PROGRESS','BLOCKED','DONE']),priority:z.enum(['HIGH','NORMAL','LOW']),phase:text.optional(),notes:text.optional()})).max(500),
 legal:z.array(z.object({id:z.string().max(100),title:z.string().max(500),status:z.enum(['NOT_STARTED','UNDER_REVIEW','VERIFIED','BLOCKED']),notes:text,group:text.optional(),critical:z.boolean().optional(),description:text.optional(),owner:text.optional(),due:z.string().max(30).optional()})).max(500),
 risks:z.array(z.object({id:z.string().max(100),title:z.string().max(500),likelihood:z.number().int().min(1).max(5),impact:z.number().int().min(1).max(5),response:text,category:text.optional(),owner:text.optional(),status:z.enum(['OPEN','MITIGATED']).optional()})).max(500),
 suppliers:z.array(z.object({id:z.string().max(100),vendor:z.string().max(300),item:z.string().max(500),offer:amount,notes:text,capacity:amount.optional(),leadDays:amount.optional(),warranty:text.optional(),status:z.enum(['NEW','REVIEW','SELECTED','REJECTED']).optional()})).max(500),
 decisions:z.array(z.object({id:z.string().max(100),title:z.string().max(500),date:z.string().max(30),notes:text,owner:text.optional(),status:z.enum(['OPEN','AGREED','DONE']).optional()})).max(500),
 handoff:z.object({mode:z.enum(['LATER','NEW','EXISTING']),organizationId:z.string().uuid().optional(),reviewedSourceUpdatedAt:date.optional(),reviewedAt:date.optional()}).optional(),
 advanced:z.object({
  mode:z.enum(['DIRECT','CAPACITY']),capacityMonthly:amount,
  utilisationPct:z.number().finite().min(0).max(100),saleablePct:z.number().finite().min(0).max(100),
  lives:z.object({BUILDINGS:z.number().int().min(0).max(60),EQUIPMENT:z.number().int().min(0).max(60),
   UTILITIES:z.number().int().min(0).max(60),LICENCES:z.number().int().min(0).max(60),
   OTHER:z.number().int().min(0).max(60)}).strict(),
  debtRatePct:z.number().finite().min(0).max(100),debtYears:z.number().int().min(0).max(20),
  terminalCash:amount,
  contingencyPct:z.number().finite().min(0).max(100).optional(),
  workingCapitalPolicy:z.object({mode:z.enum(['MANUAL','DAYS']),
   receivableDays:z.number().finite().min(0).max(365),
   inventoryDays:z.number().finite().min(0).max(365),
   payableDays:z.number().finite().min(0).max(365)
  }).strict().optional()
 }).strict().optional(),
 sectorSchedule:z.discriminatedUnion('kind',[
  z.object({kind:z.literal('INDUSTRIAL'),ratedCapacityMonthly:amount,
   operatingMonths:z.number().int().min(0).max(12),
   utilizationPct:z.number().finite().min(0).max(100),
   saleableYieldPct:z.number().finite().min(0).max(100),
   productionCashCostPerGrossUnit:amount}).strict(),
  z.object({kind:z.literal('REAL_ESTATE'),stages:z.array(z.object({
   year:z.number().int().min(1).max(20),contractedUnits:z.number().int().min(0).max(1000000000),
   contractPricePerUnit:amount,cashCollections:amount,constructionCashCost:amount,
   sellingCashCost:amount
  }).strict()).max(20)}).strict()
 ]).optional(),
 rawLand:rawLandSchema.optional(),water:waterModelSchema.optional(),preparedBy:text.optional(),studyDate:z.string().max(30).optional(),notes:text.optional(),
 createdAt:date,updatedAt:date
}).strict().refine(study=>!study.rawLand||(study.sector==='REAL_ESTATE'&&!study.water&&!study.sectorSchedule),
 {message:'Raw land requires its own real-estate model',path:['rawLand']});
export const cloudDraftWrite=z.object({study:feasibilityDraftSchema,revision:z.number().int().positive().optional()}).strict();
