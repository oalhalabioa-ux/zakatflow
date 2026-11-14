import {z} from 'zod';
import {requireUser} from './auth';
import {assertLiveStatements} from './financial-statement-live';
import {resolveCenterBranches,type CenterBranchRegistry} from '../lib/financial-center-branch-registry';
const uuid=z.string().uuid();
const date=z.string().date();
const scope=z.object({organization:uuid}).strict();
const period=scope.extend({from:date,to:date}).strict().refine(q=>q.from<=q.to);
const assignment=z.object({id:uuid,organizationId:uuid,centerId:uuid,branchId:uuid.nullable(),
 from:date,to:date.nullable(),status:z.literal('APPROVED'),approvedBy:uuid,revision:z.string().regex(/^[1-9]\d*$/)}).strict();
const registry=z.object({organizationId:uuid,complete:z.literal(true),revision:z.string().regex(/^\d+$/),
 branches:z.array(uuid).max(1000),centerIds:z.array(uuid).max(1000),assignments:z.array(assignment).max(20000)}).strict();
const command=scope.extend({center:uuid,branch:uuid.nullable(),from:date,to:date.nullable(),
 expectedRevision:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER-1),reason:z.string().trim().min(1).max(1000)
}).strict().refine(q=>q.to===null||q.from<=q.to);
function unwrap(result:{data:unknown;error:{message:string}|null}){
 if(result.error)throw Error(result.error.message.match(/\bCENTER_BRANCH_[A-Z_]+\b/)?.[0]??'CENTER_BRANCH_UNAVAILABLE');
 return result.data;
}
/** Staged server service. SQL must be promoted before a public route is enabled.
 * Reads use current-user RPC authorization; clients cannot supply completeness.
 * An editor may display gaps. Reports must use the period-validated function.
 */
export async function centerBranchRegistry(input:unknown):Promise<CenterBranchRegistry>{
 assertLiveStatements();const q=scope.parse(input),{supabase}=await requireUser();
 const parsed=registry.safeParse(unwrap(await supabase.rpc('financial_center_branch_registry',{p_org:q.organization})));
 if(!parsed.success||parsed.data.organizationId!==q.organization)throw Error('CENTER_BRANCH_REGISTRY_INVALID');
 const r=parsed.data;
 if(r.assignments.some(a=>a.organizationId!==q.organization||BigInt(a.revision)>BigInt(r.revision)))
  throw Error('CENTER_BRANCH_REGISTRY_INVALID');
 return r;
}
export async function centerBranchesForPeriod(input:unknown){
 const q=period.parse(input),r=await centerBranchRegistry({organization:q.organization});
 return{registry:r,centers:resolveCenterBranches(r,q.organization,q.from,q.to)};
}
export async function assignCenterBranch(input:unknown){
 assertLiveStatements();const q=command.parse(input),{supabase}=await requireUser();
 const raw=unwrap(await supabase.rpc('assign_financial_center_branch',{
  p_org:q.organization,p_center:q.center,p_branch:q.branch,p_from:q.from,p_to:q.to,
  p_expected_revision:q.expectedRevision,p_reason:q.reason,
 }));
 const result=z.object({id:uuid,revision:z.number().int().positive(),status:z.literal('APPROVED')}).strict().safeParse(raw);
 if(!result.success||result.data.revision!==q.expectedRevision+1)throw Error('CENTER_BRANCH_RESPONSE_INVALID');
 return result.data;
}

const transfer=scope.extend({action:z.literal('transfer'),center:uuid,branch:uuid.nullable(),from:date,
 expectedRevision:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER-1),reason:z.string().trim().min(1).max(1000)}).strict();
/** Future-only enforcement uses database time, never a browser clock. */
export async function transferCenterBranch(input:unknown){
 assertLiveStatements();const q=transfer.parse(input),{supabase}=await requireUser();
 const raw=unwrap(await supabase.rpc('transfer_financial_center_branch',{
  p_org:q.organization,p_center:q.center,p_branch:q.branch,p_from:q.from,
  p_expected_revision:q.expectedRevision,p_reason:q.reason,
 }));
 const result=z.object({id:uuid,revision:z.number().int().positive(),status:z.literal('APPROVED')}).strict().safeParse(raw);
 if(!result.success||result.data.revision!==q.expectedRevision+1)throw Error('CENTER_BRANCH_RESPONSE_INVALID');
 return result.data;
}
