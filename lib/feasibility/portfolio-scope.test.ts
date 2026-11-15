import {describe,expect,it} from 'vitest';
import {accountDraftsVisibleInScope} from './portfolio-scope';

describe('feasibility portfolio scope display',()=>{
 it('shows account drafts in Personal, preserving identity and order',()=>{
  const studies=[{id:'milk-factory'},{id:'water-factory'}] as const;
  expect(accountDraftsVisibleInScope(studies,'PERSONAL')).toBe(studies);
 });
 it('never exposes account drafts in Business merely by changing the topbar',()=>{
  const personal=[{id:'dairy',owner:'user-1'}] as const;
  expect(accountDraftsVisibleInScope(personal,'ORGANIZATION')).toEqual([]);
 });
 it('does not destroy or migrate personal drafts when toggling scope',()=>{
  const personal=[{id:'dairy',title:'Dairy & cheese factory'}];
  expect(accountDraftsVisibleInScope(personal,'ORGANIZATION')).toEqual([]);
  expect(accountDraftsVisibleInScope(personal,'PERSONAL')).toEqual(personal);
  expect(personal[0].title).toBe('Dairy & cheese factory');
 });
});
