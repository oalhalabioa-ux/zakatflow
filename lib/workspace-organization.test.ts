import {describe,it,expect,vi,afterEach} from 'vitest';
import {organizationTree,preferredOrganization,organizationScopeIds,organizationOptionLabel,rememberOrganization,rememberedOrganization,rememberedCompanyGroup} from './workspace-organization';
import {currentWorkspaceScope} from './topbar-navigation';
const organizations=[{id:'other',name:'شركة أخرى',organization_kind:'HOLDING'},{id:'child',name:'دعم الأعمال',parent_organization_id:'levant',organization_kind:'SUBSIDIARY'},{id:'grandchild',name:'فرع تابع',parent_organization_id:'child'},{id:'levant',name:'شركة ليفانت القابضة',organization_kind:'HOLDING'}];
afterEach(()=>vi.unstubAllGlobals());
describe('consistent business context',()=>{
 it('defaults to Levant and orders each parent before its descendants',()=>{
  expect(organizationTree(organizations).map(x=>[x.organization.id,x.depth])).toEqual([['levant',0],['child',1],['grandchild',2],['other',0]]);
  expect(preferredOrganization(organizations)?.id).toBe('levant');
  expect(preferredOrganization(organizations,'child')?.id).toBe('child');
  expect(preferredOrganization(organizations,'unavailable')?.id).toBe('levant');
 });
 it('groups only the selected parent and its accessible descendants',()=>{
  expect([...organizationScopeIds(organizations,'levant',true)]).toEqual(['levant','child','grandchild']);
  expect([...organizationScopeIds(organizations,'child',true)]).toEqual(['child','grandchild']);
  expect([...organizationScopeIds(organizations,'levant',false)]).toEqual(['levant']);
 });
 it('handles unavailable parents and cycles without inventing access or looping',()=>{
  const rows=[{id:'a',name:'a',parent_organization_id:'b'},{id:'b',name:'b',parent_organization_id:'a'},{id:'orphan',name:'c',parent_organization_id:'hidden'}];
  expect(new Set(organizationTree(rows).map(x=>x.organization.id)).size).toBe(3);
  expect(organizationScopeIds(rows,'a',true).has('hidden')).toBe(false);
 });
 it('uses the same root symbol and curved subsidiary arrow in both languages',()=>{
  expect(organizationOptionLabel(organizations[3],true)).toBe('▣ شركة ليفانت القابضة');
  expect(organizationOptionLabel(organizations[1],false)).toMatch(/^↳ /);
 });
 it('preserves corporate scope across dual-scope pages while respecting explicit personal links',()=>{
  for(const path of ['assets/dashboard','assets','transactions','lots','cash-and-banks','investments','reports','debts','receivables','payables','loans','debt-advances','debt-collection','dashboard']){
   expect(currentWorkspaceScope(path,'','ORGANIZATION')).toBe('ORGANIZATION');
   expect(currentWorkspaceScope(path,'scope=PERSONAL','ORGANIZATION')).toBe('PERSONAL');
  }
  expect(currentWorkspaceScope('payments','','ORGANIZATION')).toBe('PERSONAL');
  expect(currentWorkspaceScope('vat','','PERSONAL')).toBe('ORGANIZATION');
  expect(currentWorkspaceScope('investments','','ORGANIZATION')).toBe('ORGANIZATION');
 });
 it('saves company and group together without dropping current page filters',()=>{
  const map=new Map<string,string>(),storage={getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>map.set(k,v)};
  vi.stubGlobal('sessionStorage',storage);vi.stubGlobal('localStorage',storage);
  const replaceState=vi.fn();vi.stubGlobal('window',{location:{pathname:'/ar/assets',search:'?scope=ORGANIZATION&tab=valuation'},history:{replaceState},dispatchEvent:vi.fn()});
  rememberOrganization('levant',true);
  expect(rememberedOrganization()).toBe('levant');expect(rememberedCompanyGroup()).toBe(true);
  expect(replaceState.mock.calls[0][2]).toBe('/ar/assets?scope=ORGANIZATION&tab=valuation&organization=levant&level=GROUP');
 });
});
