import { z } from 'zod';
export const assetSchema=z.object({asset_type:z.enum(['CASH','BANK','GOLD','SILVER','STOCK','INVENTORY','RECEIVABLE','REAL_ESTATE','OTHER']),name:z.string().min(1).max(120),currency:z.string().length(3),unit:z.string().default('unit'),is_zakatable:z.boolean().default(true),metadata:z.record(z.string(),z.any()).default({})});
export const transactionSchema=z.object({asset_account_id:z.string().uuid(),transaction_type:z.enum(['OPENING_BALANCE','ADD','PURCHASE','SALE','WITHDRAWAL','TRANSFER_OUT','TRANSFER_IN','ZAKAT_PAYMENT','ADJUSTMENT','REVERSAL']),transaction_date:z.string(),quantity:z.coerce.number().nonnegative(),unit_price:z.coerce.number().nonnegative().optional(),currency:z.string().length(3),gross_value:z.coerce.number().nonnegative(),base_currency:z.string().length(3),base_value:z.coerce.number().nonnegative(),reference:z.string().max(200).optional(),notes:z.string().max(2000).optional(),reversal_of_transaction_id:z.string().uuid().optional(),fx_rate:z.coerce.number().positive().optional(),adjustment_direction:z.enum(['IN','OUT']).optional(),proceeds_account_id:z.preprocess(v=>v===''?undefined:v,z.string().uuid().optional()),disposal_zero_value:z.boolean().optional()}).superRefine((p,ctx)=>{if(p.transaction_type==='SALE'&&!p.proceeds_account_id)ctx.addIssue({code:'custom',message:'SALE_PROCEEDS_ACCOUNT_REQUIRED',path:['proceeds_account_id']});if(p.transaction_type==='ADJUSTMENT'&&!p.adjustment_direction&&!p.disposal_zero_value)ctx.addIssue({code:'custom',message:'ADJUSTMENT_DIRECTION_REQUIRED',path:['adjustment_direction']})});
export const transferSchema=z.object({source_asset_account_id:z.string().uuid(),destination_asset_account_id:z.string().uuid(),transfer_date:z.string(),quantity:z.coerce.number().positive(),value:z.coerce.number().positive(),currency:z.string().length(3),base_currency:z.string().length(3).default('SAR'),fx_rate:z.coerce.number().positive().default(1),notes:z.string().max(2000).optional()}).refine(p=>p.source_asset_account_id!==p.destination_asset_account_id,{message:'SOURCE_AND_DESTINATION_MUST_DIFFER'});
export const paymentSchema=z.object({hawl_cycle_id:z.string().uuid(),assessment_id:z.string().uuid().optional(),payment_date:z.string(),amount:z.coerce.number().positive(),currency:z.string().length(3),base_amount:z.coerce.number().positive(),beneficiary:z.string().max(200).optional(),reference:z.string().max(200).optional(),notes:z.string().max(2000).optional()});
export const priceSchema=z.object({asset_type:z.enum(['GOLD','SILVER','STOCK','OTHER']),instrument_code:z.string().max(80).optional(),karat:z.coerce.number().positive().max(24).optional(),price_per_unit:z.coerce.number().positive(),currency:z.string().regex(/^[A-Z]{3}$/),valuation_date:z.string().date(),source:z.string().trim().min(1).max(120)});
export const currencySchema=z.object({organization_id:z.string().uuid(),code:z.string().trim().regex(/^[A-Za-z]{3}$/).transform(v=>v.toUpperCase()),name_ar:z.string().trim().min(1).max(100),name_en:z.string().trim().min(1).max(100),symbol:z.string().trim().max(12).optional(),decimals:z.coerce.number().int().min(0).max(4).default(2)});
export const fxSchema=z.object({organization_id:z.string().uuid(),from_currency:z.string().trim().regex(/^[A-Za-z]{3}$/).transform(v=>v.toUpperCase()),to_currency:z.string().trim().regex(/^[A-Za-z]{3}$/).transform(v=>v.toUpperCase()),rate:z.coerce.number().positive(),valuation_date:z.string().date(),source:z.string().trim().min(1).max(120)}).refine(p=>p.from_currency!==p.to_currency,{message:'FX_CURRENCIES_MUST_DIFFER',path:['to_currency']});
export const vatProfileSchema=z.object({
 organization_id:z.string().uuid(),
 tax_registration_number:z.string().trim().max(30).optional().nullable(),
 registration_status:z.enum(['NOT_REGISTERED','REGISTERED','PENDING','DEREGISTERED']),
 registration_date:z.string().date().optional().nullable(),
 filing_frequency:z.enum(['MONTHLY','QUARTERLY']),
 standard_rate:z.coerce.number().refine(rate=>rate===15,{message:'SAUDI_STANDARD_VAT_RATE_MUST_BE_15'}),
 period_start_month:z.coerce.number().int().min(1).max(12),
 registered_name:z.string().trim().max(200).optional().nullable(),
 seller_street:z.string().trim().max(250).optional().nullable(),
 seller_building_number:z.string().trim().regex(/^\d{4}$/).optional().nullable(),
 seller_district:z.string().trim().max(120).optional().nullable(),
 seller_additional_number:z.string().trim().regex(/^\d{4}$/).optional().nullable(),
 seller_city:z.string().trim().max(120).optional().nullable(),
 seller_postal_code:z.string().trim().regex(/^\d{5}$/).optional().nullable(),
}).superRefine((p,ctx)=>{
 if(p.registration_status==='REGISTERED'){
  if(!p.tax_registration_number?.trim())ctx.addIssue({code:'custom',message:'VAT_REGISTRATION_NUMBER_REQUIRED',path:['tax_registration_number']});
  else if(!/^3\d{13}3$/.test(p.tax_registration_number.trim()))ctx.addIssue({code:'custom',message:'INVALID_VAT_REGISTRATION_NUMBER',path:['tax_registration_number']});
  const fields:[keyof typeof p,string][]=[['registered_name','SELLER_REGISTERED_NAME_REQUIRED'],['seller_street','SELLER_STREET_REQUIRED'],['seller_building_number','SELLER_BUILDING_NUMBER_REQUIRED'],['seller_district','SELLER_DISTRICT_REQUIRED'],['seller_additional_number','SELLER_ADDITIONAL_NUMBER_REQUIRED'],['seller_city','SELLER_CITY_REQUIRED'],['seller_postal_code','SELLER_POSTAL_CODE_REQUIRED']];
  for(const [field,message] of fields)if(!p[field])ctx.addIssue({code:'custom',message,path:[field]});
 }
});
export const vatContactSchema=z.object({
 organization_id:z.string().uuid(),
 contact_type:z.enum(['CUSTOMER','SUPPLIER','BOTH']),
 name:z.string().trim().min(1).max(200),
 vat_number:z.string().trim().max(30).optional().nullable(),
 email:z.union([z.string().trim().email().max(254),z.literal('')]).optional().nullable(),
 phone:z.string().trim().max(40).optional().nullable(),
 street:z.string().trim().max(250).optional().nullable(),
 building_number:z.string().trim().regex(/^\d{4}$/).optional().nullable(),
 district:z.string().trim().max(120).optional().nullable(),
 additional_number:z.string().trim().regex(/^\d{4}$/).optional().nullable(),
 city:z.string().trim().max(120).optional().nullable(),
 postal_code:z.string().trim().regex(/^\d{5}$/).optional().nullable(),
 country_code:z.string().trim().length(2).default('SA'),
});
export const vatDocumentSchema=z.object({organization_id:z.string().uuid(),document_type:z.enum(['SALES','PURCHASE']),document_kind:z.enum(['INVOICE','CREDIT_NOTE']),document_number:z.string().trim().min(1).max(80),transaction_date:z.string().date(),counterparty_contact_id:z.string().uuid(),counterparty_name:z.string().trim().min(1).max(160),counterparty_tax_number:z.string().trim().max(30).optional().nullable(),supply_type:z.enum(['STANDARD','ZERO_RATED','EXEMPT','OUT_OF_SCOPE']),net_amount:z.coerce.number().finite().nonnegative(),recoverable_percent:z.coerce.number().min(0).max(100).default(100),notes:z.string().trim().max(1000).optional().nullable()}).superRefine((p,ctx)=>{if(p.document_type==='SALES'&&p.recoverable_percent!==100)ctx.addIssue({code:'custom',message:'VAT_RECOVERY_SALES_ONLY',path:['recoverable_percent']})});
export const vatPeriodSummarySchema=z.object({organization_id:z.string().uuid(),period_start:z.string().date(),period_end:z.string().date(),sales_standard_base:z.coerce.number().finite().nonnegative(),sales_zero_rated_base:z.coerce.number().finite().nonnegative(),sales_exempt_base:z.coerce.number().finite().nonnegative(),sales_out_of_scope_base:z.coerce.number().finite().nonnegative(),purchases_standard_base:z.coerce.number().finite().nonnegative(),purchases_zero_rated_base:z.coerce.number().finite().nonnegative(),purchases_exempt_base:z.coerce.number().finite().nonnegative(),purchases_out_of_scope_base:z.coerce.number().finite().nonnegative(),imports_goods_base:z.coerce.number().finite().nonnegative(),imports_vat_paid:z.coerce.number().finite().nonnegative(),reverse_charge_base:z.coerce.number().finite().nonnegative(),input_tax_recoverable_percent:z.coerce.number().min(0).max(100),filing_status:z.enum(['NOT_FILED','FILED']),filed_at:z.string().date().optional().nullable(),filing_reference:z.string().trim().max(120).optional().nullable(),paid_amount:z.coerce.number().finite().nonnegative(),paid_at:z.string().date().optional().nullable(),payment_reference:z.string().trim().max(120).optional().nullable(),cash_reserved_amount:z.coerce.number().finite().nonnegative(),notes:z.string().trim().max(1000).optional().nullable()}).superRefine((p,ctx)=>{if(p.period_start>p.period_end)ctx.addIssue({code:'custom',message:'INVALID_VAT_PERIOD_RANGE',path:['period_end']});if(p.filing_status==='FILED'&&!p.filed_at)ctx.addIssue({code:'custom',message:'VAT_FILING_DATE_REQUIRED',path:['filed_at']});if(p.paid_amount>0&&!p.paid_at)ctx.addIssue({code:'custom',message:'VAT_PAYMENT_DATE_REQUIRED',path:['paid_at']})});
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
