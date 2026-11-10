import {describe,it,expect} from 'vitest';
import {sectorTemplates} from './sector-templates';
describe('bilingual sector guidance',()=>{
 it('covers all six sectors with transparent limitations',()=>{
  expect(Object.keys(sectorTemplates)).toHaveLength(6);
  for(const t of Object.values(sectorTemplates)){
   expect(t.volumeAr.length).toBeGreaterThan(5);
   expect(t.volumeEn.length).toBeGreaterThan(5);
   expect(t.warningAr.length).toBeGreaterThan(12);
   expect(t.warningEn.length).toBeGreaterThan(12);
  }
 });
 it('requires a separate property milestone schedule for real estate',()=>{
  expect(sectorTemplates.REAL_ESTATE.warningEn).toContain('milestone');
 });
});