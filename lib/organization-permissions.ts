import {permissionGroups} from './role-permission-catalog';

export const PERMISSION_GROUPS=permissionGroups.map(group=>({key:group.key,labelAr:group.ar,labelEn:group.en,permissions:group.permissions.map(p=>p.key)}));

export const SENSITIVE_PERMISSIONS = new Set([
 'financial_core.approve','financial_core.post','financial_core.reverse','financial_core.self_approve','liquidity.settle','budget.approve'
]);

export const permissionAction=(permission:string)=>permission.split('.').at(-1)??permission;
