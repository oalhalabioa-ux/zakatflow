import {z} from 'zod';
import {requireUser} from './auth';
import {assertLiveStatements} from './financial-statement-live';
import {openingScope} from '../lib/financial-opening-workspace';
const text=z.string().min(1).max(300);
const rule=z.object({eventType:text,sourceModule:text,classificationId:text,cashDirection:z.enum(['NON_CASH','INFLOW','OUTFLOW']),debitAccountId:text,creditAccountId:text,cashActivity:z.enum(['OPERATING','INVESTING','FINANCING']).optional()}).strict();
const command=z.discriminatedUnion('action',[
 z.object({action:z.literal('save'),...openingScope.shape,expectedVersion:z.number().int().min(0),rules:z.array(rule).max(5000),reason:z.string().trim().min(3).max(1000)}).strict(),
 z.object({action:z.literal('approve'),id:z.string().uuid(),expectedVersion:z.number().int().positive()}).strict(),
]);
function unwrap<T>(r:{data:T;error:{message:string}|null}){if(r.error)throw Error(r.error.message.match(/REPORTING_[A-Z_]+/)?.[0]??'REPORTING_UNAVAILABLE');return r.data}
export async function readReportingPolicy(input:unknown){assertLiveStatements();const q=openingScope.parse(input),{supabase}=await requireUser();return unwrap(await supabase.rpc('financial_reporting_policy_workspace',{p_org:q.organization,p_fiscal_start:q.fiscalStart}))}
export async function writeReportingPolicy(input:unknown){assertLiveStatements();const q=command.parse(input),{supabase}=await requireUser();return q.action==='approve'?unwrap(await supabase.rpc('approve_financial_reporting_policy',{p_id:q.id,p_expected_version:q.expectedVersion})):unwrap(await supabase.rpc('save_financial_reporting_policy',{p_org:q.organization,p_fiscal_start:q.fiscalStart,p_expected_version:q.expectedVersion,p_rules:q.rules,p_reason:q.reason}))}
