/** Separate legal-entity books from operational branches. A nullable entity_id
 * is a legitimate organization-direct entry; it does not mean that the legal
 * organization_id is missing, nor may it be assigned to an arbitrary branch. */
export type FinancialEntityReference={id:string;organizationId:string;entityType:string;active:boolean};
export type FinancialSourceReference={id:string;organizationId:string;entityId:string|null};
export type ClassifiedFinancialSource={id:string;organizationId:string;scope:'ORGANIZATION_DIRECT'|'BRANCH';branchId:string|null};

export function classifyFinancialSourceScope(
 organizationId:string,entities:readonly FinancialEntityReference[],events:readonly FinancialSourceReference[],
):ClassifiedFinancialSource[]{
 if(!organizationId)throw Error('FINANCIAL_SCOPE_ORGANIZATION_REQUIRED');
 const registry=new Map<string,FinancialEntityReference>();
 for(const entity of entities){
  if(!entity.id||registry.has(entity.id)||entity.organizationId!==organizationId)throw Error('FINANCIAL_SCOPE_ENTITY_REGISTRY_INVALID');
  registry.set(entity.id,entity);
 }
 const eventIds=new Set<string>();
 return events.map(event=>{
  if(!event.id||eventIds.has(event.id)||event.organizationId!==organizationId)throw Error('FINANCIAL_SCOPE_SOURCE_INVALID');
  eventIds.add(event.id);
  if(event.entityId===null)return{id:event.id,organizationId,scope:'ORGANIZATION_DIRECT',branchId:null};
  const entity=registry.get(event.entityId);
  // Deactivation prevents new operations; it must not remove posted history.
  // The caller still supplies an authorized, organization-scoped registry.
  if(!entity)throw Error('FINANCIAL_SCOPE_ENTITY_UNVERIFIED');
  if(entity.entityType==='BRANCH')return{id:event.id,organizationId,scope:'BRANCH',branchId:entity.id};
  if(entity.entityType==='COMPANY')return{id:event.id,organizationId,scope:'ORGANIZATION_DIRECT',branchId:null};
  throw Error('FINANCIAL_SCOPE_ENTITY_TYPE_UNVERIFIED');
 });
}
