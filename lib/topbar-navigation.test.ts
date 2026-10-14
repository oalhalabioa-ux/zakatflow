import {describe,it,expect} from 'vitest';
import {currentWorkspaceScope,workspaceScopeHref,navigationHref,searchNavigation} from './topbar-navigation';
describe('workspace scope routing',()=>{
 it('keeps each dual-scope module on its own page and preserves unrelated filters',()=>{
  for(const path of ['dashboard','assets','investments','reports','cash-and-banks','receivables','payables','debt-report','financial-position']){
   const href=workspaceScopeHref('ar',path,'scope=PERSONAL&tab=movements&organization=org','ORGANIZATION');
   expect(href).toBe('/ar/'+path+'?scope=ORGANIZATION&tab=movements&organization=org');
   expect(currentWorkspaceScope(path,'scope=ORGANIZATION')).toBe('ORGANIZATION');
   expect(currentWorkspaceScope(path,'scope=PERSONAL')).toBe('PERSONAL');
   expect(navigationHref('en',path,'ORGANIZATION')).toBe('/en/'+path+'?scope=ORGANIZATION');
  }
 });
 it('matches page defaults rather than showing a false corporate scope',()=>{
  for(const path of ['debt-report','financial-position','assets','investments','reports'])expect(currentWorkspaceScope(path,'')).toBe('PERSONAL');
  expect(currentWorkspaceScope('payables','')).toBe('ORGANIZATION');
 });
 it('routes modules without a scope filter to the scoped dashboard',()=>expect(workspaceScopeHref('ar','loans','organization=x','PERSONAL')).toBe('/ar/dashboard?scope=PERSONAL'));
 it('finds Arabic labels despite diacritics and alef variants',()=>{
  expect(searchNavigation('إِسْتِثْمَارات').map(x=>x[0])).toContain('investments');
  expect(searchNavigation('إيرادات').map(x=>x[0])).toContain('vat?section=reports');
  expect(searchNavigation('   ')).toEqual([]);
 });
});
