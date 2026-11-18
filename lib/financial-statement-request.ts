import type {StatementSourceSnapshot} from './financial-statement-source';

export type StatementRequestIdentity={
 organization:string;from:string;to:string;currency:string;
 origin:StatementSourceSnapshot['origin'];branch?:string;
};
/** Match the entire supported banner scope for display AND reauthorized export.
 * A new scoped endpoint must add its exact dimensions here before being enabled.
 * A branch/group response must never masquerade as the legal-company report.
 */
export function matchesStatementRequest(snapshot:StatementSourceSnapshot|null|undefined,request:StatementRequestIdentity):boolean{
 return !!snapshot&&!!request.organization&&!!request.currency&&
  snapshot.origin===request.origin&&
  (request.branch===undefined?snapshot.scope==='ORGANIZATION_ALL_ENTITIES'&&snapshot.branchId===undefined:
   request.branch==='HQ'?snapshot.scope==='ORGANIZATION_DIRECT'&&snapshot.branchId===null:
   snapshot.scope==='BRANCH'&&snapshot.branchId===request.branch)&&
  snapshot.statements?.organizationId===request.organization&&
  snapshot.statements?.currency===request.currency&&
  snapshot.statements?.from===request.from&&snapshot.statements?.to===request.to;
}
