import {describe,it,expect} from 'vitest';
import {platformOrganizationTree} from '../lib/platform-organization-tree';
describe('main dashboard company hierarchy',()=>{
 it('places Levant before its subsidiary despite alphabetical order or child sort order',()=>{
  const nodes=[{id:'child',name:'شركة دعم الأعمال',parent_organization_id:'parent',organization_kind:'SUBSIDIARY',sort_order:1},{id:'parent',name:'شركة ليفانت',parent_organization_id:null,organization_kind:'HOLDING',sort_order:10},{id:'grandchild',name:'فرع',parent_organization_id:'child',organization_kind:'SUBSIDIARY',sort_order:0}];
  expect(platformOrganizationTree(nodes).map(x=>[x.organization.id,x.depth])).toEqual([['parent',0],['child',1],['grandchild',2]]);
  expect(nodes[0].id).toBe('child');
 });
 it('keeps authorized children selectable when their parent is outside membership scope and handles cycles',()=>{
  const nodes=[{id:'orphan',name:'فرعية',parent_organization_id:'inaccessible'},{id:'a',name:'A',parent_organization_id:'b'},{id:'b',name:'B',parent_organization_id:'a'}];
  const result=platformOrganizationTree(nodes);
  expect(result).toHaveLength(3);expect(new Set(result.map(x=>x.organization.id)).size).toBe(3);
  expect(result.find(x=>x.organization.id==='orphan')?.depth).toBe(0);
 });
});
