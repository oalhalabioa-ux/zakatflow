import { z } from 'zod';
export const assetSchema=z.object({asset_type:z.enum(['CASH','BANK','GOLD','SILVER','STOCK','INVENTORY','RECEIVABLE','REAL_ESTATE','OTHER']),name:z.string().min(1).max(120),currency:z.string().length(3),unit:z.string().default('unit'),is_zakatable:z.boolean().default(true),metadata:z.record(z.string(),z.any()).default({})});
export const transactionSchema=z.object({asset_account_id:z.string().uuid(),transaction_type:z.enum(['OPENING_BALANCE','ADD','PURCHASE','SALE','WITHDRAWAL','TRANSFER_OUT','TRANSFER_IN','ZAKAT_PAYMENT','ADJUSTMENT','REVERSAL']),transaction_date:z.string(),quantity:z.coerce.number().nonnegative(),unit_price:z.coerce.number().nonnegative().optional(),currency:z.string().length(3),gross_value:z.coerce.number().nonnegative(),base_currency:z.string().length(3),base_value:z.coerce.number().nonnegative(),reference:z.string().max(200).optional(),notes:z.string().max(2000).optional(),reversal_of_transaction_id:z.string().uuid().optional(),fx_rate:z.coerce.number().positive().optional(),adjustment_direction:z.enum(['IN','OUT']).optional(),proceeds_account_id:z.preprocess(v=>v===''?undefined:v,z.string().uuid().optional()),disposal_zero_value:z.boolean().optional()}).superRefine((p,ctx)=>{if(p.transaction_type==='SALE'&&!p.proceeds_account_id)ctx.addIssue({code:'custom',message:'SALE_PROCEEDS_ACCOUNT_REQUIRED',path:['proceeds_account_id']});if(p.transaction_type==='ADJUSTMENT'&&!p.adjustment_direction&&!p.disposal_zero_value)ctx.addIssue({code:'custom',message:'ADJUSTMENT_DIRECTION_REQUIRED',path:['adjustment_direction']})});
export const transferSchema=z.object({source_asset_account_id:z.string().uuid(),destination_asset_account_id:z.string().uuid(),transfer_date:z.string(),quantity:z.coerce.number().positive(),value:z.coerce.number().positive(),currency:z.string().length(3),base_currency:z.string().length(3).default('SAR'),fx_rate:z.coerce.number().positive().default(1),notes:z.string().max(2000).optional()}).refine(p=>p.source_asset_account_id!==p.destination_asset_account_id,{message:'SOURCE_AND_DESTINATION_MUST_DIFFER'});
export const paymentSchema=z.object({hawl_cycle_id:z.string().uuid(),assessment_id:z.string().uuid().optional(),payment_date:z.string(),amount:z.coerce.number().positive(),currency:z.string().length(3),base_amount:z.coerce.number().positive(),beneficiary:z.string().max(200).optional(),reference:z.string().max(200).optional(),notes:z.string().max(2000).optional()});
export const priceSchema=z.object({asset_type:z.enum(['GOLD','SILVER','STOCK','OTHER']),instrument_code:z.string().max(80).optional(),karat:z.coerce.number().positive().max(24).optional(),price_per_unit:z.coerce.number().positive(),currency:z.string().length(3),valuation_date:z.string(),source:z.string().min(1).max(120)});
export const fxSchema=z.object({from_currency:z.string().length(3),to_currency:z.string().length(3),rate:z.coerce.number().positive(),valuation_date:z.string(),source:z.string().min(1).max(120)});
export const notificationSchema=z.object({type:z.string().min(1).max(60),title:z.string().min(1).max(200),body:z.string().min(1).max(2000),scheduled_for:z.string().optional(),metadata:z.record(z.string(),z.any()).optional()});

export const budgetLineSchema=z.object({
 id:z.string().uuid().optional(),
 category:z.enum(['REVENUE','COGS','OPEX','CAPEX','FINANCING','ZAKAT']),
 name:z.string().min(1).max(160),
 line_type:z.enum(['REVENUE','EXPENSE','CASH']),
 sort_order:z.coerce.number().int().nonnegative(),
 monthly_budget:z.array(z.coerce.number().finite().nonnegative()).length(12),
 monthly_actual:z.array(z.coerce.number().finite().nonnegative()).length(12).default(Array(12).fill(0)),
 monthly_forecast:z.array(z.coerce.number().finite().nonnegative()).length(12).optional()
});

export const budgetPlanSchema=z.object({
 name:z.string().min(1).max(160),
 fiscal_year:z.coerce.number().int().min(2000).max(2200),
 currency:z.string().length(3).default('SAR'),
 scenario:z.enum(['BASE','DOWNSIDE','UPSIDE']).default('BASE'),
 status:z.enum(['DRAFT','IN_REVIEW','APPROVED','ARCHIVED']).default('DRAFT'),
 organization_name:z.string().max(160).default(''),
 cost_center:z.string().max(120).default('ALL'),
 opening_cash:z.coerce.number().finite().default(0),
 minimum_cash_target:z.coerce.number().nonnegative().default(0),
 assumptions:z.record(z.string(),z.any()).default({}),
 notes:z.string().max(5000).default(''),
 lines:z.array(budgetLineSchema).min(1)
});
