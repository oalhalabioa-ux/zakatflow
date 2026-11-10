import {z} from 'zod';
const amount=z.number().finite().min(0).max(1000000000000);
const percent=z.number().finite().min(0).max(100000);
const text=z.string().max(5000);
const sector=z.enum(['INDUSTRIAL','COMMERCIAL','REAL_ESTATE','SERVICES','AGRICULTURE','CUSTOM']);
const date=z.string().datetime();
export const feasibilityDraftSchema=z.object({
 id:z.string().uuid(),title:z.string().trim().min(1).max(300),sector,
 country:z.string().trim().min(1).max(120),region:z.string().max(150),
 currency:z.string().regex(/^[A-Z]{3}$/),
 status:z.enum(['IDEA','FEASIBILITY','APPROVED','ESTABLISHMENT','OPERATING','CANCELLED']),
 landValue:amount,landTransferred:z.boolean(),investorEquity:amount,partnerCashEquity:amount,
 investorLoan:amount,otherDebt:amount,workingCapital:amount,annualMaintenance:amount,
 unitPrice:amount,variableCost:amount,monthlyUnits:amount,monthlyFixedCost:amount,
 volumeGrowthPct:percent,priceGrowthPct:percent,fixedCostGrowthPct:percent,discountRatePct:percent,indicativeTaxRatePct:percent,
 years:z.number().int().min(1).max(20),
 capex:z.array(z.object({id:z.string().max(100),label:z.string().max(300),amount,category:z.enum(['BUILDINGS','EQUIPMENT','UTILITIES','LICENCES','OTHER'])})).max(500),
 tasks:z.array(z.object({id:z.string().max(100),title:z.string().max(400),owner:z.string().max(300),due:z.string().max(30),status:z.enum(['TODO','IN_PROGRESS','DONE']),priority:z.enum(['HIGH','NORMAL','LOW'])})).max(500),
 legal:z.array(z.object({id:z.string().max(100),title:z.string().max(500),status:z.enum(['NOT_STARTED','UNDER_REVIEW','VERIFIED','BLOCKED']),notes:text})).max(500),
 risks:z.array(z.object({id:z.string().max(100),title:z.string().max(500),likelihood:z.number().int().min(1).max(5),impact:z.number().int().min(1).max(5),response:text})).max(500),
 suppliers:z.array(z.object({id:z.string().max(100),vendor:z.string().max(300),item:z.string().max(500),offer:amount,notes:text})).max(500),
 decisions:z.array(z.object({id:z.string().max(100),title:z.string().max(500),date:z.string().max(30),notes:text})).max(500),
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
 createdAt:date,updatedAt:date
}).strict();
export const cloudDraftWrite=z.object({study:feasibilityDraftSchema,revision:z.number().int().positive().optional()}).strict();
