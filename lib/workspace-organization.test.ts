import {describe,it,expect,vi,afterEach} from 'vitest';
import {organizationTree,preferredOrganization,requestedOrganization,organizationScopeIds,organizationOptionLabel,rememberOrganization,rememberedOrganization,rememberedCompanyGroup} from './workspace-organization';
import {currentWorkspaceScope,workspaceScopeHref} from './topbar-navigation';
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
  expect(currentWorkspaceScope('payments','','ORGANIZATION')).toBe('ORGANIZATION');
  expect(currentWorkspaceScope('vat','','PERSONAL')).toBe('PERSONAL');
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
 it('clears old company selectors and aliases before announcing a deliberate company change',()=>{
  const map=new Map<string,string>([['zf-liquidity-org','levant']]),storage={getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>map.set(k,v)};
  vi.stubGlobal('sessionStorage',storage);vi.stubGlobal('localStorage',storage);
  const replaceState=vi.fn(),dispatchEvent=vi.fn();
  vi.stubGlobal('window',{location:{pathname:'/en/assets',search:'?scope=ORGANIZATION&organization_id=levant&level=GROUP&entity=e&entity_id=e&branch=b&branch_id=b&cost_center=c&cost_center_id=c&center=c&center_id=c&tab=valuation&year=2026'},history:{replaceState},dispatchEvent});
  rememberOrganization('child');
  const url=new URL(replaceState.mock.calls[0][2],'https://app.invalid');
  expect(Object.fromEntries(url.searchParams)).toEqual({scope:'ORGANIZATION',level:'GROUP',tab:'valuation',year:'2026',organization:'child'});
  expect(replaceState.mock.invocationCallOrder[0]).toBeLessThan(dispatchEvent.mock.invocationCallOrder[0]);
 });
 it('keeps current company filters on a display-level change and canonicalizes its alias',()=>{
  const map=new Map<string,string>(),storage={getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>map.set(k,v)};
  vi.stubGlobal('sessionStorage',storage);vi.stubGlobal('localStorage',storage);
  const replaceState=vi.fn();
  vi.stubGlobal('window',{location:{pathname:'/en/financial-reports',search:'?scope=ORGANIZATION&organization_id=levant&entity=branch-a&center=center-a&screen=position'},history:{replaceState},dispatchEvent:vi.fn()});
  rememberOrganization('levant',false);
  const query=new URL(replaceState.mock.calls[0][2],'https://app.invalid').searchParams;
  expect(query.get('entity')).toBe('branch-a');expect(query.get('center')).toBe('center-a');expect(query.get('screen')).toBe('position');expect(query.get('organization_id')).toBeNull();expect(query.get('organization')).toBe('levant');expect(query.get('level')).toBe('COMPANY');
 });
});

it.each(['opening-balances/branches','opening-balances/centers'])('keeps %s institutional across refresh, copied links and personal-scope history',path=>{
 for(const query of ['','scope=PERSONAL','scope=ORGANIZATION']){
  expect(currentWorkspaceScope(path,query,'PERSONAL')).toBe('ORGANIZATION');
 }
 expect(workspaceScopeHref('ar',path,'organization=company&fiscalStart=2026-01-01','ORGANIZATION'))
  .toBe('/ar/'+path+'?organization=company&fiscalStart=2026-01-01&scope=ORGANIZATION');
 expect(workspaceScopeHref('en',path,'organization=company','PERSONAL')).toBe('/en/dashboard?scope=PERSONAL');
});

it('never replaces an explicit unavailable company with a remembered or first company',()=>{
 expect(requestedOrganization(organizations,'unavailable','levant')).toBeUndefined();
 expect(requestedOrganization(organizations,'','levant')).toBeUndefined();
 expect(requestedOrganization(organizations,'child','levant')?.id).toBe('child');
 expect(requestedOrganization(organizations,null,'child')?.id).toBe('child');
 expect(requestedOrganization(organizations,null,'old-removed')?.id).toBe('levant');
});
