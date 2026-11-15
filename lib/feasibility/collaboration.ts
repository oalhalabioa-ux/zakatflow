/** Presentation policy for QA collaboration; database RLS remains authoritative. */
export type ProjectMemberRole='EDITOR'|'REVIEWER'|'VIEWER';
export type ProjectMemberStatus='INVITED'|'ACTIVE'|'REVOKED';
export function collaboratorPermissions(role:ProjectMemberRole,status:ProjectMemberStatus){
 const active=status==='ACTIVE';
 return {canRead:active,canEdit:active&&role==='EDITOR',canReview:active&&(role==='EDITOR'||role==='REVIEWER'),canManageInvites:false};
}
