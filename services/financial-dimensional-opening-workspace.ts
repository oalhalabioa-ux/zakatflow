import {branchOpeningEditorContext} from './financial-branch-opening-workspace';
import {centerBranchRegistry} from './financial-center-branch-registry';
import {z} from 'zod';
import {requireUser} from './auth';
import {assertOpeningWorkspace} from './financial-opening-workspace';

const scope=z.object({organization:z.string().uuid(),fiscalStart:z.string().date()}).strict();
const amount=z.string().regex(/^\d{1,20}(\.\d{1,4})?$/);
const allocation=z.object({branchId:z.string().uuid().nullable(),centerId:z.string().uuid().nullable(),debit:amount,credit:amount}).strict();
const save=scope.extend({
 action:z.literal('save'),expectedVersion:z.number().int().min(0),
 openingWorkspace:z.string().uuid(),openingVersion:z.number().int().positive(),
 entries:z.record(z.string().min(1).max(200),z.array(allocation).min(1).max(1001)),
 reason:z.string().max(1000),
}).strict();
const approve=z.object({action:z.literal('approve'),id:z.string().uuid(),expectedVersion:z.number().int().positive(),scope:scope.optional()}).strict();
const command=z.discriminatedUnion('action',[save,approve]);
export type DimensionalOpeningCommand=z.infer<typeof command>;
function unwrap<T>(result:{data:T;error:{message:string}|null}):T{
 if(result.error){
  const code=result.error.message.match(/DIMENSION_OPENING_[A-Z_]+/)?.[0];
  throw Error(code??'DIMENSION_OPENING_UNAVAILABLE');
 }
 return result.data;
}
/**
 * Authenticated editor adapter, feature-gated at the public route.
 * Context is editor evidence, never report approval.
 * All reads and writes execute as the signed-in user. These are the private
 * versioned opening distribution RPCs, NOT journal posting operations.
 * Server-side RPCs enforce membership/permissions again and lock approvals.
 */
export async function dimensionalOpeningContext(input:unknown){
 assertOpeningWorkspace();const q=scope.parse(input),{supabase}=await requireUser();
 return unwrap(await supabase.rpc('financial_dimensional_opening_context',{
  p_org:q.organization,p_fiscal_start:q.fiscalStart,
 }));
}
export async function dimensionalOpeningCommand(input:unknown){
 assertOpeningWorkspace();const q=command.parse(input),{supabase}=await requireUser();
 if(q.action==='approve'){
  if(q.scope){
   const draft=unwrap(await supabase.rpc('financial_dimensional_opening_context',{p_org:q.scope.organization,p_fiscal_start:q.scope.fiscalStart}));
   if(draft?.organizationId!==q.scope.organization||draft?.fiscalStart!==q.scope.fiscalStart||draft?.id!==q.id)
    throw Error('DIMENSION_OPENING_APPROVE_DENIED');
   if(draft.status!=='DRAFT'||draft.version!==q.expectedVersion)throw Error('DIMENSION_OPENING_VERSION_CONFLICT');
  }
  return unwrap(await supabase.rpc('approve_financial_dimensional_opening',{
   p_distribution:q.id,p_expected_version:q.expectedVersion,
  }));
 }
 return unwrap(await supabase.rpc('save_financial_dimensional_opening',{
  p_org:q.organization,p_fiscal_start:q.fiscalStart,
  p_expected_version:q.expectedVersion,p_opening_workspace:q.openingWorkspace,
  p_opening_version:q.openingVersion,p_entries:q.entries,p_reason:q.reason,
 }));
}

export async function dimensionalOpeningEditorContext(input:unknown){
 const q=scope.parse(input),base=await branchOpeningEditorContext(q),distribution=await dimensionalOpeningContext(q);
 const registry=await centerBranchRegistry({organization:q.organization}),{supabase}=await requireUser();
 const result=await supabase.from('organization_cost_centers').select('id,organization_id,name').eq('organization_id',q.organization).limit(1001);
 if(result.error||!Array.isArray(result.data)||result.data.length>1000||result.data.some(c=>c.organization_id!==q.organization))throw Error('DIMENSION_OPENING_UNAVAILABLE');
 const centers=result.data.flatMap(c=>{
  const assignments=registry.assignments.filter(a=>a.centerId===c.id&&a.status==='APPROVED'&&a.from<=q.fiscalStart&&(a.to===null||a.to>=q.fiscalStart));
  if(assignments.length>1)throw Error('DIMENSION_OPENING_CENTER_INVALID');
  return assignments.length?[{id:c.id,name:c.name,branchId:assignments[0].branchId}]:[];
 });
 // Recheck current user's authorization after all independent editor reads.
 await dimensionalOpeningContext(q);
 return{...base,distribution,centers};
}
