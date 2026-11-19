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
 * This single-slice resolver requires one branch per center for the entire
 * slice. Use resolveCenterBranchTimeline for a period spanning transfers.
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

/** Complete contiguous historical slices; never apply today's branch to old
 * activity. Every slice passes the same overlap/approval/coverage checks. */
export function resolveCenterBranchTimeline(registry:CenterBranchRegistry,organizationId:string,from:string,to:string){
 if(!day(from)||!day(to)||from>to)throw Error('CENTER_BRANCH_REGISTRY_SCOPE_INVALID');
 const next=(date:string)=>new Date(Date.parse(date+'T00:00:00Z')+86400000).toISOString().slice(0,10);
 const previous=(date:string)=>new Date(Date.parse(date+'T00:00:00Z')-86400000).toISOString().slice(0,10);
 const starts=new Set([from]);
 for(const a of registry.assignments){
  if(a.status!=='APPROVED')continue;
  if(day(a.from)&&a.from>from&&a.from<=to)starts.add(a.from);
  if(a.to!==null&&day(a.to)&&a.to>=from&&a.to<to)starts.add(next(a.to));
 }
 const ordered=[...starts].sort();
 return ordered.map((start,i)=>{const end=i+1<ordered.length?previous(ordered[i+1]):to;
  return{from:start,to:end,centers:resolveCenterBranches(registry,organizationId,start,end)};
 });
}
