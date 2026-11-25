import {describe,expect,it} from 'vitest';
import {legacyAssessmentHref} from './legacy-workspace-navigation';

describe('legacy consolidation retirement',()=>{
 it('routes company bookmarks to the real manual assessment with the same company and group',()=>{
  const url=new URL(legacyAssessmentHref('ar',{scope:'ORGANIZATION',organization:'company-a',level:'GROUP',source:'register',branch:'branch-a'}),'https://example.invalid');
  expect(url.pathname).toBe('/ar/assessments');
  expect(Object.fromEntries(url.searchParams)).toEqual({scope:'ORGANIZATION',organization:'company-a',level:'GROUP',source:'manual',branch:'branch-a'});
 });
 it('preserves explicit personal scope and clears every stale company dimension',()=>{
  const url=new URL(legacyAssessmentHref('en',{scope:'PERSONAL',organization:'company-a',organization_id:'company-a',level:'GROUP',entity_id:'entity',cost_center_id:'center'}),'https://example.invalid');
  expect(Object.fromEntries(url.searchParams)).toEqual({scope:'PERSONAL',source:'register'});
 });
 it('retains a requested personal manual assessment and canonicalizes old company aliases',()=>{
  expect(legacyAssessmentHref('ar',{scope:'PERSONAL',source:'manual'})).toBe('/ar/assessments?scope=PERSONAL&source=manual');
  expect(new URL(legacyAssessmentHref('ar',{organization_id:['company-b','other']}),'https://example.invalid').searchParams.get('organization')).toBe('company-b');
 });
});
