import {describe,expect,it} from 'vitest';
import {settingSections,sidebarSettingSections,isSidebarSettingSectionActive} from './navigation';

describe('complete settings sidebar navigation',()=>{
 it('matches all six primary sections and leaves subscription plans last',()=>{
  expect(sidebarSettingSections.map(s=>s.path)).toEqual([
   ...settingSections.filter(s=>s.group==='primary').map(s=>s.path),'billing',
  ]);
  expect(new Set(sidebarSettingSections.map(s=>s.path)).size).toBe(7);
 });
 it('highlights each section independently instead of assigning tax/team to organization',()=>{
  for(const section of sidebarSettingSections){
   expect(sidebarSettingSections.filter(s=>isSidebarSettingSectionActive(section.path,s.path)).map(s=>s.path)).toEqual([section.path]);
  }
 });
 it('retains nested fiscal, personal setup and organization structure routes',()=>{
  const cases=[['settings/financial/fiscal-years','settings/financial'],['settings/personal-setup','settings/financial/setup'],['settings/structure','settings']];
  for(const [path,expected] of cases){
   expect(sidebarSettingSections.filter(s=>isSidebarSettingSectionActive(path,s.path)).map(s=>s.path)).toEqual([expected]);
  }
 });
});
