import {describe,expect,it} from 'vitest';
import {feasibilityOrganizationContext} from './workspace-organization';

const organizations=[{id:'company-a',name:'Company A'},{id:'company-b',name:'Company B'}];
describe('feasibility company restoration',()=>{
 it('requires an actual company choice in a fresh business context',()=>{
  expect(feasibilityOrganizationContext('scope=ORGANIZATION','ORGANIZATION',organizations,null))
   .toEqual({organizationId:'',canonicalQuery:null});
 });
 it('does not turn a company parameter on a personal URL into a remembered selection',()=>{
  expect(feasibilityOrganizationContext('scope=PERSONAL&organization=company-a','PERSONAL',organizations,null))
   .toEqual({organizationId:'',canonicalQuery:null});
 });
 it('keeps the deliberate recipient available for personal copy without adding it to the personal URL',()=>{
  expect(feasibilityOrganizationContext('scope=PERSONAL&organization=company-b','PERSONAL',organizations,'company-a'))
   .toEqual({organizationId:'company-a',canonicalQuery:null});
 });
 it('restores the authorized choice to the business URL on return and retains study parameters',()=>{
  const result=feasibilityOrganizationContext('scope=ORGANIZATION&tab=report','ORGANIZATION',organizations,'company-a');
  expect(result.organizationId).toBe('company-a');
  expect(Object.fromEntries(new URLSearchParams(result.canonicalQuery!)))
   .toEqual({scope:'ORGANIZATION',tab:'report',organization:'company-a',level:'COMPANY'});
 });
 it('does not restore a remembered company absent from the authorized catalog',()=>{
  expect(feasibilityOrganizationContext('scope=ORGANIZATION','ORGANIZATION',organizations,'revoked-company'))
   .toEqual({organizationId:'',canonicalQuery:null});
 });
 it('preserves an explicit unavailable company for the API to reject instead of falling back',()=>{
  expect(feasibilityOrganizationContext('scope=ORGANIZATION&organization=unavailable','ORGANIZATION',organizations,'company-a'))
   .toEqual({organizationId:'unavailable',canonicalQuery:null});
 });
 it('honors explicit organization aliases before the remembered company',()=>{
  expect(feasibilityOrganizationContext('scope=ORGANIZATION&organization_id=company-b','ORGANIZATION',organizations,'company-a'))
   .toEqual({organizationId:'company-b',canonicalQuery:null});
 });
});
