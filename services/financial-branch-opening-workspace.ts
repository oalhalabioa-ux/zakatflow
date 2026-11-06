import {z} from 'zod';
import {requireUser} from './auth';
import {assertOpeningWorkspace} from './financial-opening-workspace';

const scope=z.object({organization:z.string().uuid(),fiscalStart:z.string().date()}).strict();
const amount=z.string().regex(/^\d{1,20}(\.\d{1,4})?$/);
const allocation=z.object({branchId:z.string().uuid().nullable(),debit:amount,credit:amount}).strict();
const save=scope.extend({
 action:z.literal('save'),expectedVersion:z.number().int().min(0),
 openingWorkspace:z.string().uuid(),openingVersion:z.number().int().positive(),
 entries:z.record(z.string().min(1).max(200),z.array(allocation).min(1).max(1001)),
 reason:z.string().max(1000),
}).strict();
const approve=z.object({action:z.literal('approve'),id:z.string().uuid(),expectedVersion:z.number().int().positive()}).strict();
const command=z.discriminatedUnion('action',[save,approve]);
export type BranchOpeningCommand=z.infer<typeof command>;
function unwrap<T>(result:{data:T;error:{message:string}|null}):T{
 if(result.error){
  const code=result.error.message.match(/BRANCH_OPENING_[A-Z_]+/)?.[0];
  throw Error(code??'BRANCH_OPENING_UNAVAILABLE');
 }
 return result.data;
}
/**
 * All reads and writes execute as the signed-in user. These are the private
 * versioned opening distribution RPCs, NOT journal posting operations.
 * Server-side RPCs enforce membership/permissions again and lock approvals.
 */
export async function branchOpeningContext(input:unknown){
 assertOpeningWorkspace();const q=scope.parse(input),{supabase}=await requireUser();
 return unwrap(await supabase.rpc('financial_branch_opening_context',{
  p_org:q.organization,p_fiscal_start:q.fiscalStart,
 }));
}
export async function branchOpeningCommand(input:unknown){
 assertOpeningWorkspace();const q=command.parse(input),{supabase}=await requireUser();
 if(q.action==='approve')return unwrap(await supabase.rpc('approve_financial_branch_opening',{
  p_distribution:q.id,p_expected_version:q.expectedVersion,
 }));
 return unwrap(await supabase.rpc('save_financial_branch_opening',{
  p_org:q.organization,p_fiscal_start:q.fiscalStart,
  p_expected_version:q.expectedVersion,p_opening_workspace:q.openingWorkspace,
  p_opening_version:q.openingVersion,p_entries:q.entries,p_reason:q.reason,
 }));
}
