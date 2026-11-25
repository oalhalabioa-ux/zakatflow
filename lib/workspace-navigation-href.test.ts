import {describe,expect,it} from 'vitest';
import {workspaceNavigationHref} from './workspace-navigation-href';
import {currentWorkspaceScope,isClientWorkspaceScope,workspaceScopeHref} from './topbar-navigation';

const personal={scope:'PERSONAL' as const,organization:'old-company',group:true};
const business={scope:'ORGANIZATION' as const,organization:'company-a',group:true};

describe('navigation follows the banner scope',()=>{
 it.each(['assets','assets/dashboard','transactions','lots','assessments','payments','cash-and-banks','receivables','payables','loans','debt-advances','debt-collection','debt-report','financial-position','investments','reports','reports/print','feasibility','financial-reports','prices','workflow','enterprise'])(
  'keeps %s personal even after a company was selected',page=>{
   const href=workspaceNavigationHref(`/ar/${page}`,personal);
   expect(href).toBe(`/ar/${page}?scope=PERSONAL`);
   expect(currentWorkspaceScope(page,new URL(href,'https://app.invalid').search,'ORGANIZATION')).toBe('PERSONAL');
  });
 it('honors an explicit personal report link instead of rewriting it to Business',()=>{
  expect(workspaceNavigationHref('/en/financial-reports?scope=PERSONAL&organization=company-a&level=GROUP&screen=income',business))
   .toBe('/en/financial-reports?scope=PERSONAL');
 });
 it('removes organization and branch selectors on personal scope switches while keeping ordinary filters',()=>{
  const href=workspaceScopeHref('ar','assets','scope=ORGANIZATION&organization=company-a&organization_id=company-a&level=GROUP&entity=branch-a&branch_id=branch-a&cost_center=center-a&tab=movements&year=2026','PERSONAL');
  expect(href).toBe('/ar/assets?scope=PERSONAL&tab=movements&year=2026');
 });
 it('preserves the selected company and group in business reports',()=>{
  expect(workspaceNavigationHref('/en/financial-reports?screen=position',business))
   .toBe('/en/financial-reports?screen=position&scope=ORGANIZATION&organization=company-a&level=GROUP');
  expect(workspaceNavigationHref('/en/financial-reports?screen=position&organization=company-b',business))
   .toBe('/en/financial-reports?screen=position&organization=company-b&scope=ORGANIZATION&level=COMPANY');
 });
 it('preserves explicit company-level selection and report anchors',()=>{
  expect(workspaceNavigationHref('/en/financial-reports?level=COMPANY#position',business))
   .toBe('/en/financial-reports?level=COMPANY&scope=ORGANIZATION&organization=company-a#position');
 });
 it('honors legacy explicit organization aliases over remembered company and group',()=>{
  const query=new URL(workspaceNavigationHref('/en/vat?organization_id=company-b',business),'https://app.invalid').searchParams;
  expect(query.get('organization')).toBe('company-b');expect(query.get('organization_id')).toBe('company-b');expect(query.get('level')).toBe('COMPANY');
  const conflict=new URL(workspaceNavigationHref('/en/assets?organization=company-b&organization_id=company-a',business),'https://app.invalid').searchParams;
  expect(conflict.get('organization')).toBe('company-b');expect(conflict.get('organization_id')).toBe('company-b');
 });
 it.each(['settings/system','account','notifications','guide','governance'])('keeps %s in the chosen scope without company filters',page=>{
  for(const selection of [personal,business]){
   const href=workspaceNavigationHref(`/ar/${page}?organization=old-company&level=GROUP`,selection);
   expect(href).toBe(`/ar/${page}?scope=${selection.scope}`);
   expect(currentWorkspaceScope(page,'',selection.scope)).toBe(selection.scope);
  }
 });
 it('opens the existing personal setup journey from the personal sidebar',()=>{
  expect(workspaceNavigationHref('/ar/settings/financial/setup',personal)).toBe('/ar/settings/personal-setup?scope=PERSONAL');
  expect(workspaceNavigationHref('/ar/settings/financial/setup',business)).toContain('/ar/settings/financial/setup?scope=ORGANIZATION');
  expect(workspaceScopeHref('en','settings/financial/setup','organization=company-a','PERSONAL')).toBe('/en/settings/personal-setup?scope=PERSONAL');
  expect(workspaceScopeHref('en','settings/personal-setup','','ORGANIZATION')).toBe('/en/settings/financial/setup?scope=ORGANIZATION');
 });
 it.each(['opening-balances','chart-of-accounts','financial-reporting-policy','vat','liquidity','budget-planning','settings/financial'])('does not pretend the organization-only %s supports personal data',page=>{
  const href=workspaceNavigationHref(`/ar/${page}`,personal);
  expect(new URL(href,'https://app.invalid').searchParams.get('scope')).toBe('ORGANIZATION');
 });
 it('leaves external links outside workspace rewriting',()=>{
  expect(workspaceNavigationHref('https://example.com/ar/assets?scope=PERSONAL',business)).toBe('https://example.com/ar/assets?scope=PERSONAL');
 });
});

it.each(['transactions/transaction-a','lots/lot-a'])('keeps %s record details scoped and returns to a list on a banner scope switch',page=>{
 expect(currentWorkspaceScope(page,'scope=ORGANIZATION&organization=company-a','PERSONAL')).toBe('ORGANIZATION');
 expect(isClientWorkspaceScope(page)).toBe(false);
 expect(workspaceScopeHref('ar',page,'scope=ORGANIZATION&organization=company-a','ORGANIZATION')).toBe('/ar/'+page+'?scope=ORGANIZATION&organization=company-a');
 expect(workspaceScopeHref('ar',page,'scope=ORGANIZATION&organization=company-a','PERSONAL')).toBe('/ar/'+page.split('/')[0]+'?scope=PERSONAL');
 expect(workspaceScopeHref('en',page,'scope=PERSONAL','ORGANIZATION')).toBe('/en/'+page.split('/')[0]+'?scope=ORGANIZATION');
});
