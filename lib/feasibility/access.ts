/** Standalone study licence, not organization accounting authorization. */
export type FeasibilityAccessGrant={
 status:'TRIAL'|'ACTIVE'|'READ_ONLY'|'SUSPENDED'|'CANCELLED';
 starts_at:string;ends_at:string|null;
};
export function evaluateFeasibilityAccess(grant:FeasibilityAccessGrant|null|undefined,now=new Date()){
 const denied={canRead:false,canWrite:false,readOnly:false};
 if(!grant)return denied;
 const at=now.getTime(),start=Date.parse(grant.starts_at),end=grant.ends_at===null?Infinity:Date.parse(grant.ends_at);
 if(!Number.isFinite(at)||!Number.isFinite(start)||Number.isNaN(end)||end<=start||at<start)return denied;
 const canWrite=(grant.status==='TRIAL'||grant.status==='ACTIVE')&&at<end;
 return {canRead:true,canWrite,readOnly:!canWrite};
}
