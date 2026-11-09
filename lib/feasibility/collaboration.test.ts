import {describe,it,expect} from 'vitest';
import {collaboratorPermissions} from './collaboration';
describe('project collaboration role separation',()=>{
 it('never grants access for pending or revoked membership',()=>{
  for(const role of ['VIEWER','REVIEWER','EDITOR'] as const)
   for(const status of ['INVITED','REVOKED'] as const)
    expect(collaboratorPermissions(role,status)).toEqual({canRead:false,canEdit:false,canReview:false,canManageInvites:false});
 });
 it('makes active viewing and review non-editing roles',()=>{
  expect(collaboratorPermissions('VIEWER','ACTIVE')).toEqual({canRead:true,canEdit:false,canReview:false,canManageInvites:false});
  expect(collaboratorPermissions('REVIEWER','ACTIVE')).toEqual({canRead:true,canEdit:false,canReview:true,canManageInvites:false});
 });
 it('reserves editing to active editors and invites to the owner',()=>{
  expect(collaboratorPermissions('EDITOR','ACTIVE')).toEqual({canRead:true,canEdit:true,canReview:true,canManageInvites:false});
 });
