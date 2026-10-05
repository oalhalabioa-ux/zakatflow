import {z} from 'zod';

const uuid=z.string().uuid();
const text=z.string().trim().min(1).max(240);
const money=z.number().finite().positive();
const currency=z.string().regex(/^[A-Z]{3}$/);
const dimensions={organization_id:uuid,entity_id:uuid.nullable(),cost_center_id:uuid.nullable()};
const line=z.object({line_number:z.number().int().positive(),description:z.string().max(500),classification_id:uuid,cost_center_id:uuid.nullable(),amount:money,currency,exchange_rate:money,base_amount:money,cash_direction:z.enum(['NON_CASH','INFLOW','OUTFLOW']),vat_treatment:z.literal('OUT_OF_SCOPE'),vat_rate:z.literal(0),vat_amount:z.literal(0)}).strict();
const link=z.object({link_type:z.enum(['SOURCE','ASSET','VAT','OTHER']),target_module:z.string().trim().min(1).max(80),target_record_id:uuid,metadata:z.record(z.string(),z.any()).default({})}).strict();
const obligation=z.object({obligation_key:text,obligation_type:z.enum(['PAYABLE','RECEIVABLE']),settleable_amount:money,currency,exchange_rate:money,base_currency:currency,settleable_base_amount:money}).strict();
export const eventPayloadSchema=z.object({organization_id:uuid,entity_id:uuid.nullable(),counterparty_id:uuid.nullable(),event_type:z.enum(['EXPENSE','REVENUE','ASSET_PURCHASE','SETTLEMENT']),source_module:z.enum(['OPERATIONAL_CONSOLE','ASSETS_INTEGRATION']),source_record_id:uuid.nullable().optional(),source_event_key:text,event_date:z.string().date(),due_date:z.string().date().nullable(),base_currency:currency,description:z.string().trim().max(1000),lines:z.array(line).min(1).max(50),obligations:z.array(obligation).max(50),links:z.array(link).max(50).default([])}).strict();
export const financialEventActionSchema=z.discriminatedUnion('action',[
 z.object({action:z.literal('CREATE'),payload:eventPayloadSchema}).strict(),
 z.object({action:z.literal('PREPARE_VAT'),organization_id:uuid,source_table:z.enum(['vat_documents','vat_einvoices']),source_id:uuid,entity_id:uuid,due_date:z.string().date()}).strict(),
 z.object({action:z.literal('TRANSITION'),organization_id:uuid,event_id:uuid,status:z.enum(['PLANNED','COMMITTED','CANCELLED','ACTUAL']),note:z.string().max(500)}).strict(),
 z.object({action:z.literal('APPROVE'),organization_id:uuid,event_id:uuid,note:z.string().max(500)}).strict(),
 z.object({action:z.literal('RECOGNIZE_VAT'),organization_id:uuid,event_id:uuid}).strict(),
 z.object({action:z.literal('POST_SETTLEMENT'),organization_id:uuid,event_id:uuid,account_id:uuid,direction:z.enum(['INFLOW','OUTFLOW']),settlement_date:z.string().date(),amount:money,currency,exchange_rate:money,base_amount:money,allocations:z.array(z.object({obligation_id:uuid,flow_id:uuid,amount:money,base_amount:money,flow_amount:money,flow_currency:currency,flow_exchange_rate:money}).strict()).min(1).max(50)}).strict(),
 z.object({action:z.literal('CLASSIFICATION'),organization_id:uuid,code:z.string().trim().min(1).max(60),name:z.string().trim().min(1).max(160),classification_type:z.enum(['REVENUE','OPEX','CAPEX','ASSET','LIABILITY','FINANCING','INVESTMENT','TAX','RECEIVABLE','PAYABLE'])}).strict(),
 z.object({action:z.literal('ROUTE'),...dimensions,entity_id:uuid,event_id:uuid,key:text}).strict()
]);
export type FinancialEventAction=z.infer<typeof financialEventActionSchema>;
export type EventPermission='financial_core.create'|'financial_core.approve'|'financial_core.post'|'financial_core.view'|'liquidity.edit'|'vat.view'|'organization.edit';
export type EventPermissions=Record<EventPermission,boolean>;
export function allowedEventActions(event:{status:string;event_type:string;source_module:string;created_by:string},user:string,permissions:EventPermissions,independentlyApproved:boolean){
 const actions:string[]=[];
 if(permissions['financial_core.create']){
  if(event.status==='DRAFT')actions.push('PLANNED');
  if(event.status==='PLANNED')actions.push('COMMITTED');
  if(['DRAFT','PLANNED','COMMITTED'].includes(event.status))actions.push('CANCELLED');
 }
 if(event.status==='COMMITTED'&&permissions['financial_core.approve']&&event.created_by!==user&&!independentlyApproved)actions.push('APPROVE');
 if(event.status==='COMMITTED'&&independentlyApproved&&permissions['financial_core.post']){
  if(event.event_type==='SETTLEMENT'){if(permissions['liquidity.edit'])actions.push('POST_SETTLEMENT');}
  else if(event.source_module==='VAT_INTEGRATION'){if(permissions['vat.view']&&permissions['liquidity.edit'])actions.push('RECOGNIZE_VAT');}
  else actions.push('ACTUAL');
 }
 return actions;
}
