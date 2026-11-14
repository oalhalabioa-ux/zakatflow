export type CenterBranchAssignment={
 id:string;organizationId:string;centerId:string;branchId:string|null;
 from:string;to:string|null;status:'APPROVED'|'DRAFT'|'SUPERSEDED';
 approvedBy:string|null;revision:string;
};
export type CenterBranchRegistry={
 organizationId:string;complete:true;revision:string;
 branches:readonly string[];centerIds:readonly string[];
 assignments:readonly CenterBranchAssignment[];
};
function day(value:string){return /^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value}
/** Authenticated storage must establish registry completeness. Effective dates
 * are inclusive. Current center metadata is never a historical assignment.
 * The current three-statement engine has one branch per center per period;
 * a mid-period transfer therefore fails explicitly until temporal slices exist.
 */
export function resolveCenterBranches(registry:CenterBranchRegistry,organizationId:string,from:string,to:string){
 if(registry.organizationId!==organizationId||registry.complete!==true||!registry.revision?.trim()||!day(from)||!day(to)||from>to)
  throw Error('CENTER_BRANCH_REGISTRY_SCOPE_INVALID');
 const branches=new Set(registry.branches),centers=new Set(registry.centerIds),ids=new Set<string>();
 if(branches.size!==registry.branches.length||centers.size!==registry.centerIds.length||[...branches,...centers].some(id=>!id))
  throw Error('CENTER_BRANCH_REGISTRY_INVALID');
 for(const a of registry.assignments){
  if(!a.id||ids.has(a.id)||a.organizationId!==organizationId||!centers.has(a.centerId)||
   (a.branchId!==null&&!branches.has(a.branchId))||!day(a.from)||(a.to!==null&&(!day(a.to)||a.to<a.from))||
   !['APPROVED','DRAFT','SUPERSEDED'].includes(a.status)||!a.revision?.trim()||
   (a.status!=='DRAFT'&&!a.approvedBy?.trim()))throw Error('CENTER_BRANCH_ASSIGNMENT_INVALID');
  ids.add(a.id);
 }
 return registry.centerIds.map(id=>{
  const approved=registry.assignments.filter(a=>a.centerId===id&&a.status==='APPROVED').sort((a,b)=>a.from.localeCompare(b.from));
  for(let i=1;i<approved.length;i++)if(approved[i-1].to===null||approved[i].from<=approved[i-1].to!)
   throw Error('CENTER_BRANCH_ASSIGNMENT_OVERLAP');
  const relevant=approved.filter(a=>a.from<=to&&(a.to===null||a.to>=from));
  if(relevant.length===0)throw Error('CENTER_BRANCH_ASSIGNMENT_MISSING');
  if(relevant.length!==1)throw Error('CENTER_BRANCH_PERIOD_SPLIT_REQUIRED');
  const a=relevant[0];
  if(a.from>from||(a.to!==null&&a.to<to))throw Error('CENTER_BRANCH_PERIOD_INCOMPLETE');
  return{id,branchId:a.branchId};
 });
}
