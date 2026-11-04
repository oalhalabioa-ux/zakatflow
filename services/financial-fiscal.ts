import {z} from 'zod';
import {requireUser} from './auth';
import {assertOpeningWorkspace} from './financial-opening-workspace';
const uuid=z.string().uuid(),date=z.string().date(),reason=z.string().trim().min(3).max(1000);
const command=z.discriminatedUnion('action',[
 z.object({action:z.literal('calendar'),organization:uuid,month:z.number().int().min(1).max(12),day:z.number().int().min(1).max(31),retainedAccount:z.string().regex(/^\d{4}$/),expectedVersion:z.number().int().min(0),reason}).strict(),
 z.object({action:z.literal('assign'),organization:uuid,sourceTable:z.enum(['transactions','liquidity_accounts','financial_event_obligations']),sourceId:uuid,fiscalStart:date,effectiveDate:date,accountCode:z.string().regex(/^\d{4}$/),declaredAmount:z.string().regex(/^\d{1,20}(\.\d{1,4})?$/).nullable(),reason}).strict(),
 z.object({action:z.literal('close'),organization:uuid,fiscalStart:date,requestId:uuid,reason}).strict(),
 z.object({action:z.literal('reopen'),organization:uuid,closeId:uuid,expectedVersion:z.number().int().positive(),reason}).strict(),
]);
function unwrap<T>(result:{data:T;error:{message:string}|null}){if(result.error)throw Error(result.error.message.match(/(?:FISCAL|OPENING|REPORTING)_[A-Z_]+/)?.[0]??'FISCAL_UNAVAILABLE');return result.data}
export async function fiscalContext(organization:unknown){assertOpeningWorkspace();const org=uuid.parse(organization),{supabase}=await requireUser();return unwrap(await supabase.rpc('financial_fiscal_context',{p_org:org}))}
export async function fiscalCommand(input:unknown){
 assertOpeningWorkspace();const p=command.parse(input),{supabase}=await requireUser();
 if(p.action==='calendar')return unwrap(await supabase.rpc('save_financial_fiscal_calendar',{p_org:p.organization,p_month:p.month,p_day:p.day,p_retained:p.retainedAccount,p_expected_version:p.expectedVersion,p_reason:p.reason}));
 if(p.action==='assign')return unwrap(await supabase.rpc('assign_financial_opening_source',{p_org:p.organization,p_table:p.sourceTable,p_id:p.sourceId,p_fiscal_start:p.fiscalStart,p_effective_date:p.effectiveDate,p_account:p.accountCode,p_declared_amount:p.declaredAmount,p_reason:p.reason}));
 if(p.action==='close')return unwrap(await supabase.rpc('close_financial_year',{p_org:p.organization,p_start:p.fiscalStart,p_request:p.requestId,p_reason:p.reason}));
 return unwrap(await supabase.rpc('reopen_financial_year',{p_org:p.organization,p_close:p.closeId,p_expected_version:p.expectedVersion,p_reason:p.reason}));
}
