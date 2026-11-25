import {describe,expect,it} from 'vitest';
import {recordWorkspaceOwner,recordWorkspaceSelection,recordMatchesWorkspace,recordWorkspaceHref} from './record-workspace-scope';

const company={scope:'ORGANIZATION' as const,organizationId:'company-a'},personal={scope:'PERSONAL' as const,organizationId:null};
describe('record detail owner and banner boundaries',()=>{
 it('derives the owner from the authorized record and owning asset',()=>{
  expect(recordWorkspaceOwner({asset_accounts:{ownership_scope:'PERSONAL',organization_id:null}})).toEqual(personal);
  expect(recordWorkspaceOwner({record:{organization_id:'company-a'},asset:{ownership_scope:'ORGANIZATION',organization_id:'company-a'}})).toEqual(company);
 });
 it('rejects incomplete or contradictory record/asset ownership instead of labeling it personal',()=>{
  for(const value of [null,{error:'denied'},{asset_accounts:{}},{asset_accounts:{ownership_scope:'ORGANIZATION',organization_id:null}},
   {asset_accounts:{ownership_scope:'PERSONAL',organization_id:'company-a'}},
   {organization_id:'company-b',asset_accounts:{ownership_scope:'ORGANIZATION',organization_id:'company-a'}},
   {organization_id:null,asset_accounts:{ownership_scope:'ORGANIZATION',organization_id:'company-a'}}])expect(recordWorkspaceOwner(value)).toBeNull();
 });
 it('never displays personal records as company data or company records as personal',()=>{
  expect(recordMatchesWorkspace(company,{...personal,group:false})).toBe(false);
  expect(recordMatchesWorkspace(personal,{...company,group:false})).toBe(false);
  expect(recordMatchesWorkspace(company,{scope:'ORGANIZATION',organizationId:'company-b',group:false})).toBe(false);
  expect(recordMatchesWorkspace(company,{scope:'ORGANIZATION',organizationId:null,group:false})).toBe(false);
  expect(recordMatchesWorkspace(company,{...company,group:false})).toBe(true);
 });
 it('allows a group descendant only through the authorized organization tree',()=>{
  const organizations=[{id:'company-a',name:'A'},{id:'child',name:'Child',parent_organization_id:'company-a'},{id:'company-b',name:'B'}];
  const selection={...company,group:true};
  expect(recordMatchesWorkspace({scope:'ORGANIZATION',organizationId:'child'},selection,organizations)).toBe(true);
  expect(recordMatchesWorkspace({scope:'ORGANIZATION',organizationId:'company-b'},selection,organizations)).toBe(false);
  expect(recordMatchesWorkspace({scope:'ORGANIZATION',organizationId:'child'},selection,organizations.slice(1))).toBe(false);
 });
 it('respects explicit company aliases, blank selections and browser history over remembered defaults',()=>{
  expect(recordWorkspaceSelection('?organization_id=company-b&level=COMPANY','ORGANIZATION','company-a',true)).toEqual({scope:'ORGANIZATION',organizationId:'company-b',group:false});
  expect(recordWorkspaceSelection('?organization=','ORGANIZATION','company-a').organizationId).toBe('');
  expect(recordWorkspaceSelection('?organization=company-b','ORGANIZATION','company-a',true).group).toBe(false);
  expect(recordWorkspaceSelection('?organization=company-a&level=GROUP','PERSONAL','company-a',true)).toEqual({...personal,group:false});
 });
 it('preserves exact company/group context in back and replacement links',()=>{
  expect(recordWorkspaceHref('ar','transactions',{...company,group:true},'replacement')).toBe('/ar/transactions/replacement?scope=ORGANIZATION&organization=company-a&level=GROUP');
  expect(recordWorkspaceHref('en','lots',{...company,group:true})).toBe('/en/lots?scope=ORGANIZATION&organization=company-a&level=GROUP');
  expect(recordWorkspaceHref('ar','transactions',{...personal,group:false},'original')).toBe('/ar/transactions/original?scope=PERSONAL');
 });
});
