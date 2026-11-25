import {describe,expect,it} from 'vitest';
import {financialRegisterSelection} from './financial-register-workspace-scope';

const organizations=[{id:'holding',name:'Holding',organization_kind:'HOLDING'},{id:'child',name:'Child',parent_organization_id:'holding'},{id:'other',name:'Other'}];
describe('financial register company selection',()=>{
 it('never substitutes a missing explicit company with remembered or holding company',()=>{
  for(const query of ['?organization=denied','?organization_id=denied','?organization='])
   expect(financialRegisterSelection(organizations,query,{remembered:'other'})).toEqual({organizationId:'',group:false,unavailable:true});
 });
 it('keeps URL selection authoritative on mount and history restoration',()=>{
  expect(financialRegisterSelection(organizations,'?organization=child&level=GROUP',{remembered:'other',rememberedGroup:true}))
   .toEqual({organizationId:'child',group:false,unavailable:false});
  expect(financialRegisterSelection(organizations,'?organization=holding&level=GROUP',{remembered:'other'}))
   .toEqual({organizationId:'holding',group:true,unavailable:false});
  expect(financialRegisterSelection(organizations,'?organization=holding',{remembered:'other',rememberedGroup:true}).group).toBe(false);
 });
 it('uses a remembered authorized company only when URL has no company request',()=>{
  expect(financialRegisterSelection(organizations,'',{remembered:'other'}).organizationId).toBe('other');
  expect(financialRegisterSelection([], '', {remembered:'removed'})).toEqual({organizationId:'',group:false,unavailable:false});
 });
 it('keeps setup pinned to its exact company without a group fallback',()=>{
  expect(financialRegisterSelection(organizations,'?organization=other&level=GROUP',{preferredOrg:'holding',setupEmbedded:true}))
   .toEqual({organizationId:'holding',group:false,unavailable:false});
  expect(financialRegisterSelection(organizations,'?organization=other',{preferredOrg:'removed',setupEmbedded:true}))
   .toEqual({organizationId:'',group:false,unavailable:true});
 });
});
