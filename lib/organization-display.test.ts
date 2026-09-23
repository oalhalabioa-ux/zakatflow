import {describe,expect,it} from 'vitest';
import {costCenterDisplayName,organizationDisplayName} from './organization-display';

describe('organization and cost-center display names',()=>{
 it('keeps stored Arabic labels in the Arabic interface',()=>{
  expect(organizationDisplayName('شركة ليفانت القابضة',true)).toBe('شركة ليفانت القابضة');
  expect(costCenterDisplayName('الإدارة العامة',true)).toBe('الإدارة العامة');
 });

 it('translates the known holding-company name and administration scope',()=>{
  expect(organizationDisplayName('شركة ليفانت القابضة',false)).toBe('Levant Holding');
  expect(organizationDisplayName('شركة ليفانت القابضة - الإدارة',false)).toBe('Levant Holding — Administration');
  expect(costCenterDisplayName('الإدارة العامة',false)).toBe('Head Office');
  expect(costCenterDisplayName('التشغيل',false)).toBe('Operations');
 });

 it('renders unlisted Arabic names in Latin characters while translating common business terms',()=>{
  const label=organizationDisplayName('شركة النور للتطوير العقاري',false);
  expect(label).toContain('Company');
  expect(label).toContain('Real Estate Development');
  expect(label).not.toMatch(/[\u0600-\u06ff]/);
 });
});
