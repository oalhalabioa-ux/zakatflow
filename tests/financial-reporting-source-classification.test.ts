import {describe,expect,it} from 'vitest';
import {classifyFinancialSourceScope} from '../lib/financial-reporting-scope';

const parent='10000000-0000-4000-8000-000000000001';
const subsidiary='20000000-0000-4000-8000-000000000002';
const registry=[
 {id:'headquarters',organizationId:parent,entityType:'COMPANY',active:true},
 {id:'branch-a',organizationId:parent,entityType:'BRANCH',active:true},
];

describe('reporting scopes: company direct, branches, and subsidiaries',()=>{
 it('keeps organization-direct transactions valid with no branch, even if the company has a registered branch',()=>{
  const rows=classifyFinancialSourceScope(parent,registry,[
   {id:'company-direct',organizationId:parent,entityId:null},
   {id:'company-headquarters',organizationId:parent,entityId:'headquarters'},
   {id:'branch-operation',organizationId:parent,entityId:'branch-a'},
  ]);
  expect(rows.map(r=>[r.id,r.scope,r.branchId])).toEqual([
   ['company-direct','ORGANIZATION_DIRECT',null],
   ['company-headquarters','ORGANIZATION_DIRECT',null],
   ['branch-operation','BRANCH','branch-a'],
  ]);
  expect(rows).toHaveLength(3); // One source event -> one reporting classification.
 });
 it('treats each legal subsidiary as its own organization, never a branch of the parent',()=>{
  expect(()=>classifyFinancialSourceScope(parent,registry,[{id:'subsidiary',organizationId:subsidiary,entityId:null}]))
   .toThrow('FINANCIAL_SCOPE_SOURCE_INVALID');
  expect(classifyFinancialSourceScope(subsidiary,[],[{id:'subsidiary',organizationId:subsidiary,entityId:null}]))
   .toMatchObject([{organizationId:subsidiary,scope:'ORGANIZATION_DIRECT',branchId:null}]);
 });
 it('fails closed on foreign, missing or unsupported branch references',()=>{
  const source=(entityId:string)=>[{id:'event',organizationId:parent,entityId}];
  expect(()=>classifyFinancialSourceScope(parent,registry,source('unknown'))).toThrow('FINANCIAL_SCOPE_ENTITY_UNVERIFIED');
  expect(()=>classifyFinancialSourceScope(parent,registry,source(''))).toThrow('FINANCIAL_SCOPE_ENTITY_UNVERIFIED');
  expect(()=>classifyFinancialSourceScope(parent,[{...registry[1],entityType:'PROJECT'}],source('branch-a'))).toThrow('FINANCIAL_SCOPE_ENTITY_TYPE_UNVERIFIED');
  expect(()=>classifyFinancialSourceScope(parent,[{...registry[1],organizationId:subsidiary}],[])).toThrow('FINANCIAL_SCOPE_ENTITY_REGISTRY_INVALID');
 });
 it('retains historical attribution when a branch or headquarters is deactivated',()=>{
  const sources=[
   {id:'old-branch-entry',organizationId:parent,entityId:'branch-a'},
   {id:'old-hq-entry',organizationId:parent,entityId:'headquarters'},
  ];
  expect(classifyFinancialSourceScope(parent,registry.map(e=>({...e,active:false})),sources))
   .toEqual(classifyFinancialSourceScope(parent,registry,sources));
 });
 it('rejects duplicate sources rather than double counting',()=>{
  expect(()=>classifyFinancialSourceScope(parent,registry,[{id:'one',organizationId:parent,entityId:null},{id:'one',organizationId:parent,entityId:'branch-a'}]))
   .toThrow('FINANCIAL_SCOPE_SOURCE_INVALID');
 });
});
