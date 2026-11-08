import {describe,expect,it} from 'vitest';
import {normalizedOrganizationLegalFields} from './organization-legal-identity';

describe('tenant-owned organization legal identity',()=>{
 it('normalizes optional country and registry data without claiming tax compliance',()=>{
  expect(normalizedOrganizationLegalFields({country_code:' sa ',commercial_registration_number:' 101001 ',registered_address:' Riyadh  '}))
   .toEqual({country_code:'SA',commercial_registration_number:'101001',registered_address:'Riyadh'});
  expect(normalizedOrganizationLegalFields({})).toEqual({});
  expect(normalizedOrganizationLegalFields({country_code:'',commercial_registration_number:null,registered_address:'  '}))
   .toEqual({country_code:null,commercial_registration_number:null,registered_address:null});
 });
 it('rejects fabricated or overly long identity inputs',()=>{
  expect(()=>normalizedOrganizationLegalFields({country_code:'Saudi Arabia'})).toThrow('ORGANIZATION_COUNTRY_INVALID');
  expect(()=>normalizedOrganizationLegalFields({country_code:'1S'})).toThrow('ORGANIZATION_COUNTRY_INVALID');
  expect(()=>normalizedOrganizationLegalFields({commercial_registration_number:'x'.repeat(81)})).toThrow('ORGANIZATION_REGISTRATION_INVALID');
  expect(()=>normalizedOrganizationLegalFields({registered_address:'x'.repeat(501)})).toThrow('ORGANIZATION_LEGAL_ADDRESS_INVALID');
  expect(()=>normalizedOrganizationLegalFields({registered_address:{value:'unsafe'}})).toThrow('ORGANIZATION_LEGAL_ADDRESS_INVALID');
 });
});
