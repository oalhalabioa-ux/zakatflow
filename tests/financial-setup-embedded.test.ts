import {describe,it,expect} from 'vitest';
import {setupEmbeddedUrl} from '../lib/financial-setup-embedded';
const org='26bfab1d-1699-462e-b365-8d4d32166dd9';
const original='/ar/settings/financial/fiscal-years?organization='+org+'&fromSetup=1';
describe('connected financial setup windows',()=>{
 it('preserves organization and only adds same-origin setup embedding',()=>{
  const url=setupEmbeddedUrl(original,org);
  expect(url).toContain('/ar/settings/financial/fiscal-years?');
  expect(url).toContain('organization='+org);
  expect(url).toContain('setupEmbed=1');
 });
 it('allows all seven live stages in Arabic and English',()=>{
  for(const stage of ['settings','settings/financial/fiscal-years','chart-of-accounts',
   'financial-reporting-policy','cash-and-banks','opening-balances','users']){
   for(const locale of ['ar','en'])
    expect(setupEmbeddedUrl('/'+locale+'/'+stage+'?organization='+org,org)).not.toBeNull();
  }
 });
 it('denies cross-tenant, non-company and absolute external URLs',()=>{
  expect(setupEmbeddedUrl('/ar/users?organization=foreign',org)).toBeNull();
  expect(setupEmbeddedUrl('//evil.example/ar/users?organization='+org,org)).toBeNull();
  expect(setupEmbeddedUrl('https://evil.example/ar/users?organization='+org,org)).toBeNull();
  expect(setupEmbeddedUrl('/ar/login?organization='+org,org)).toBeNull();
  expect(setupEmbeddedUrl('/ar/dashboard?organization='+org,org)).toBeNull();
 });
 it('keeps cash & banking in corporate scope and industry templates intact',()=>{
  const url=setupEmbeddedUrl('/en/cash-and-banks?organization='+org+'&scope=ORGANIZATION',org);
  expect(url).toContain('scope=ORGANIZATION');
  expect(setupEmbeddedUrl('/en/chart-of-accounts?organization='+org+'&template=HEALTH',org))
    .toContain('template=HEALTH');
 });
});
