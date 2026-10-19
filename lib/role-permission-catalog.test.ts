import {describe,it,expect} from 'vitest';
import {normalizeRolePermissions,toggleRolePermission,permissionKeys,permissionGroups,rolePresets} from './role-permission-catalog';
describe('Role permission dependencies',()=>{
 it('adds all transitive prerequisites for reversal',()=>expect(normalizeRolePermissions(['financial_core.reverse'])).toEqual(expect.arrayContaining(['financial_core.reverse','financial_core.post','financial_core.approve','financial_core.view'])));
 it('removes every dependent when approval is removed',()=>expect(toggleRolePermission(normalizeRolePermissions(['financial_core.reverse','financial_core.self_approve','liquidity.view']),'financial_core.approve',false)).toEqual(expect.arrayContaining(['financial_core.view','liquidity.view'])));
 it('does not leave reversal behind after disabling approval',()=>expect(toggleRolePermission(normalizeRolePermissions(['financial_core.reverse']),'financial_core.approve',false)).not.toContain('financial_core.reverse'));
 it('removes issuance and editing when VAT viewing is disabled',()=>expect(toggleRolePermission(normalizeRolePermissions(['vat.issue']),'vat.view',false)).toEqual([]));
 it('does not grant settlement or self approval just for preparing loans',()=>{const p=rolePresets.find(p=>p.id==='balances')!;expect(p.permissions).not.toContain('liquidity.settle');expect(p.permissions).not.toContain('financial_core.self_approve');expect(p.permissions).not.toContain('financial_core.approve')});
 it('uses unique real keys in every preset',()=>{expect(new Set(permissionGroups.flatMap(g=>g.permissions.map(p=>p.key))).size).toBe(permissionGroups.flatMap(g=>g.permissions).length);for(const p of rolePresets)expect(p.permissions.every(k=>permissionKeys.has(k))).toBe(true)});
 it('preserves unrelated selections and does not silently drop unrecognized legacy values',()=>expect(toggleRolePermission(['legacy.read','assets.view','assets.edit','budget.view'],'assets.view',false)).toEqual(['legacy.read','budget.view']));
});
