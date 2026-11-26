import {describe,expect,it} from 'vitest';
import {transactionAssetInWorkspace,transactionCashAccounts,transactionWorkspaceKey} from './transaction-workspace-scope';
const ids=new Set(['company-a','child-a']);
const personal={id:'personal-gold',ownership_scope:'PERSONAL',organization_id:null,asset_type:'GOLD',currency:'SAR'};
const company={...personal,id:'company-gold',ownership_scope:'ORGANIZATION',organization_id:'company-a'};
const accounts=[
 {...personal,id:'personal-bank',asset_type:'BANK'},
 {...personal,id:'personal-usd',asset_type:'BANK',currency:'USD'},
 {...company,id:'company-bank',asset_type:'BANK'},
 {...company,id:'child-bank',asset_type:'BANK',organization_id:'child-a'},
 {...company,id:'foreign-bank',asset_type:'BANK',organization_id:'company-b'},
];
describe('transaction draft scope',()=>{
 it('rejects a stale company asset after switching to personal even when it remains in the loaded catalog',()=>{
  expect(transactionAssetInWorkspace(company,'PERSONAL',ids)).toBe(false);
  expect(transactionAssetInWorkspace(personal,'PERSONAL',ids)).toBe(true);
  expect(transactionAssetInWorkspace({...company,organization_id:null},'PERSONAL',ids)).toBe(false);
 });
 it('rejects personal and foreign selections after switching company while permitting the selected group',()=>{
  expect(transactionAssetInWorkspace(personal,'ORGANIZATION',ids)).toBe(false);
  expect(transactionAssetInWorkspace({...company,organization_id:'company-b'},'ORGANIZATION',ids)).toBe(false);
  expect(transactionAssetInWorkspace({...company,organization_id:'child-a'},'ORGANIZATION',ids)).toBe(true);
 });
 it('offers proceeds/funding accounts only from the asset owner and currency',()=>{
  expect(transactionCashAccounts(accounts,personal,'PERSONAL',ids).map(a=>a.id)).toEqual(['personal-bank']);
  expect(transactionCashAccounts(accounts,company,'ORGANIZATION',ids).map(a=>a.id)).toEqual(['company-bank']);
  expect(transactionCashAccounts(accounts,company,'PERSONAL',ids)).toEqual([]);
  expect(transactionCashAccounts(accounts,undefined,'PERSONAL',ids)).toEqual([]);
 });
 it('includes foreign cash only for a personal purchase with explicit funding currency',()=>{
  expect(transactionCashAccounts(accounts,personal,'PERSONAL',ids,true).map(a=>a.id))
   .toEqual(['personal-bank','personal-usd']);
  const companyUsd={...company,id:'company-usd',asset_type:'BANK',currency:'USD'};
  expect(transactionCashAccounts([...accounts,companyUsd],company,'ORGANIZATION',ids,true).map(a=>a.id))
   .toEqual(['company-bank']);
 });
 it('changes draft identity on company, group or ownership changes without tying personal drafts to a remembered company',()=>{
  expect(new Set([
   transactionWorkspaceKey('PERSONAL','company-a',true),
   transactionWorkspaceKey('ORGANIZATION','company-a',false),
   transactionWorkspaceKey('ORGANIZATION','company-a',true),
   transactionWorkspaceKey('ORGANIZATION','company-b',false),
  ]).size).toBe(4);
  expect(transactionWorkspaceKey('PERSONAL','company-a',true)).toBe(transactionWorkspaceKey('PERSONAL','company-b',false));
 });
});
